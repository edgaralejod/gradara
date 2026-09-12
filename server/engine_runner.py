"""Executed inside the isolated OpenModelica container, with one immutable model."""
import json
from pathlib import Path
from OMPython import OMCSessionZMQ

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
        error = omc.sendExpression('getErrorString()')
        if not value or 'Error:' in error:
            raise RuntimeError(error or 'The component did not pass compilation checks.')
        (root/'engine.json').write_text(json.dumps({'checked': True, 'message': value}))
    else:
        result = omc.sendExpression('simulate(Gradara.System, startTime=0, stopTime='+str(config['duration'])+', numberOfIntervals=6000, tolerance=1e-6, method="dassl", outputFormat="csv", fileNamePrefix="simulation")')
        error = omc.sendExpression('getErrorString()')
        if not isinstance(result, dict) or not result.get('resultFile'):
            raise RuntimeError(error or str(result))
        if 'LOG_SUCCESS' not in result.get('messages',''):
            raise RuntimeError(result.get('messages') or error or 'Simulation did not complete.')
        (root/'engine.json').write_text(json.dumps({'result':result,'diagnostics':error}))
    omc.sendExpression('quit()')
except Exception as exc:
    (root/'engine.json').write_text(json.dumps({'error':str(exc)}))
    raise
