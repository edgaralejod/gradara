"""Executed inside the isolated OpenModelica container, with one immutable model."""
import json
from pathlib import Path
from OMPython import OMCSessionZMQ

def diagnostic_text(value):
    if value is None: return ''
    text = str(value).strip()
    # OMPython may return the literal Modelica string when parsing fails.
    if text.startswith('"') and text.endswith('"'):
        try: text = json.loads(text)
        except (ValueError, TypeError): pass
    return text.strip()


def failure_detail(result, error):
    parts = [diagnostic_text(error)]
    if isinstance(result, dict): parts.append(diagnostic_text(result.get('messages')))
    else: parts.append(diagnostic_text(result))
    log = root/'simulation.log'
    if log.exists(): parts.append(log.read_text(errors='replace')[-8000:])
    return '\n'.join(dict.fromkeys(p for p in parts if p)) or 'OpenModelica did not complete the simulation. Check equations, initial conditions, and input connections.'

root = Path('/work')
config = json.loads((root/'request.json').read_text())
try:
    omc = OMCSessionZMQ()
    omc.sendExpression('cd("/work")')
    if not omc.sendExpression('loadModel(Modelica, {"4.1.0"})'):
        raise RuntimeError(omc.sendExpression('getErrorString()'))
    if not omc.sendExpression('loadFile("/work/model.mo")'):
        raise RuntimeError(omc.sendExpression('getErrorString()'))
    if config.get('checkOnly'):
        value = omc.sendExpression('checkModel(Gradara.Component)')
        error = diagnostic_text(omc.sendExpression('getErrorString()'))
        if not value or 'Error:' in error:
            raise RuntimeError(error or 'The component did not pass compilation checks.')
        (root/'engine.json').write_text(json.dumps({'checked': True, 'message': value}))
    else:
        result = omc.sendExpression('simulate(Gradara.System, startTime=0, stopTime='+str(config['duration'])+', numberOfIntervals=6000, tolerance=1e-6, method="dassl", outputFormat="csv", fileNamePrefix="simulation")')
        error = diagnostic_text(omc.sendExpression('getErrorString()'))
        if not isinstance(result, dict) or not result.get('resultFile'):
            raise RuntimeError(failure_detail(result, error))
        if 'The simulation finished successfully.' not in result.get('messages',''):
            raise RuntimeError(failure_detail(result, error))
        (root/'engine.json').write_text(json.dumps({'result':result,'diagnostics':error}))
    omc.sendExpression('quit()')
except Exception as exc:
    (root/'engine.json').write_text(json.dumps({'error':str(exc)}))
    raise
