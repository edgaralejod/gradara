#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Check that a Linux engine bundle simulates on a clean system that has only
# gcc (what the Gradara .deb depends on): runs an MSL circuit in a container.
#
#   packaging/engine/test_clean_linux.sh BUNDLE_DIR [IMAGE ...]   (default: ubuntu:22.04 ubuntu:24.04 debian:12)
set -euo pipefail
bundle=$(cd "${1:?usage: test_clean_linux.sh BUNDLE_DIR [IMAGE ...]}" && pwd)
shift
images=("$@"); [ ${#images[@]} -gt 0 ] || images=(ubuntu:22.04 ubuntu:24.04 debian:12)
for image in "${images[@]}"; do
  echo "=== $image"
  docker run --rm -v "$bundle:/engine:ro" "$image" bash -euc '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends gcc libc6-dev >/dev/null
    libs=$(python3 -c "import json;print(json.load(open(\"/engine/manifest.json\"))[\"libraries\"])" 2>/dev/null || sed -n "s/.*\"libraries\": \"\([^\"]*\)\".*/\1/p" /engine/manifest.json)
    export OPENMODELICAHOME=/engine OPENMODELICALIBRARY=/engine/lib/omlibrary LD_LIBRARY_PATH=/engine/$libs PATH=/engine/bin:$PATH HOME=/tmp/home
    mkdir -p /tmp/home /tmp/w && cd /tmp/w
    cat > model.mo <<MO
model RC
  Modelica.Electrical.Analog.Basic.Resistor r(R=1000);
  Modelica.Electrical.Analog.Basic.Capacitor c(C=1e-6);
  Modelica.Electrical.Analog.Sources.StepVoltage v(V=5, startTime=0);
  Modelica.Electrical.Analog.Basic.Ground g;
equation
  connect(v.p, r.p); connect(r.n, c.p); connect(c.n, g.p); connect(v.n, g.p);
end RC;
MO
    printf "%s\n" "setCompiler(\"gcc\");" "loadModel(Modelica, {\"4.1.0\"}); getErrorString();" "loadFile(\"model.mo\"); getErrorString();" \
      "res := simulate(RC, stopTime=0.005, numberOfIntervals=500, outputFormat=\"csv\"); getErrorString();" "res.messages;" > s.mos
    /engine/bin/omc s.mos > omc.log 2>&1 || true
    grep -q "The simulation finished successfully" omc.log || { tail -40 omc.log; exit 1; }
    # Capacitor voltage at 5 ms (5 time constants): 5*(1-exp(-5)) = 4.9663 V.
    awk -F, "NR==1{for(i=1;i<=NF;i++) if(\$i==\"\\\"c.v\\\"\"||\$i==\"c.v\") col=i} END{v=\$col; if (v<4.96||v>4.972) {print \"c.v =\", v; exit 1} print \"c.v(5 ms) =\", v, \"V (expected 4.9663)\"}" RC_res.csv
  '
done
