#!/bin/bash
cd "/Users/santhakumar/Documents/Playground 2/Godsview"
base64 -D < _bundle.b64 > _one-commit.bundle
git bundle verify _one-commit.bundle
git pull _one-commit.bundle main
rm -f _bundle.b64 _one-commit.bundle _decode_bundle.sh
echo "DONE - Changes applied!"
git log --oneline -3
