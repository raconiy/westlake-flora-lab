"""Run the offline GLB comparison and record GPU utilization until Blender exits.

python3 run_leaf_normal_ab.py frozen.blend output-dir baseline.glb candidate.glb
"""
from pathlib import Path
import json
import subprocess
import sys
import time

blend, output, before, after = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
telemetry_path = output / 'gpu-utilization.csv'
render_script = Path(__file__).with_name('render_leaf_normal_ab.py')
telemetry = subprocess.Popen([
    'nvidia-smi', '--query-gpu=timestamp,index,name,memory.used,utilization.gpu,power.draw',
    '--format=csv,noheader,nounits', '--loop=2', '--filename=' + str(telemetry_path),
])
command = ['/usr/bin/blender', '-b', str(blend), '-P', str(render_script), '--',
           str(output), str(before), str(after)]
start = time.time()
try:
    result = subprocess.run(command, check=False)
finally:
    telemetry.terminate()
    telemetry.wait(timeout=10)
receipt = {'command': command, 'startEpoch': start, 'endEpoch': time.time(),
           'returnCode': result.returncode, 'telemetry': telemetry_path.name}
(output / 'runner-receipt.json').write_text(json.dumps(receipt, indent=2))
sys.exit(result.returncode)
