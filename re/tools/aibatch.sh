#!/bin/bash
# usage: aibatch.sh OUTROOT "n:level:seed ..."
OUT=$1; shift
for spec in $@; do
  IFS=: read n lvl seed <<< "$spec"
  keys="$n$lvl"
  for i in $(seq 1 $n); do keys="${keys}W$i\ny$(( (i-1)%8+1 ))$(( (i+2)%8+1 ))"; done
  keys="$keys  "
  d="$OUT/ai_${n}_${lvl}_${seed}"
  mkdir -p "$d"
  ( python re/tools/rngtrace.py "$(cygpath -w $d)" $seed "$keys" 600000 > "$d/run.txt" 2>&1; python re/tools/rngcmp.py "$(cygpath -w $d)" > "$d/result.txt" 2>&1 ) &
done
wait
for d in $OUT/ai_*; do echo "$(basename $d): $(tail -1 $d/result.txt)"; done
