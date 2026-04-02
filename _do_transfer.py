#!/usr/bin/env python3
"""Transfer helper: reads b64 chunks from stdin, writes decoded file."""
import base64, sys, os

BASE = '/Users/santhakumar/Documents/Playground 2/Godsview'

def transfer(relpath):
    print(f"Paste b64 for {relpath}, then type END on its own line:")
    lines = []
    for line in sys.stdin:
        if line.strip() == 'END':
            break
        lines.append(line.strip())
    b64str = ''.join(lines)
    data = base64.b64decode(b64str)
    target = os.path.join(BASE, relpath)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(data)
    print(f"OK: wrote {len(data)} bytes to {target}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        transfer(sys.argv[1])
    else:
        print("Usage: python3 _do_transfer.py <relative_path>")
