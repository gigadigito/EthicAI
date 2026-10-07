#!/usr/bin/env python3
"""Generate complete Italian (it-IT) translation for CriptoVersus."""
import json, os, sys

base = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, base)

en_path = os.path.join(base, "i18n.en-US.json")
out_path = os.path.join(base, "i18n.it-IT.json")

with open(en_path, "r", encoding="utf-8") as f:
    en = json.load(f)

# Import all translation parts
from translate_part1 import T as T1
from translate_part2 import T2
from translate_part3 import T3
from translate_part4 import T4
from translate_part5 import T5
from translate_part6 import T6

# Merge all translations
T = {}
T.update(T1)
T.update(T2)
T.update(T3)
T.update(T4)
T.update(T5)
T.update(T6)

print(f"Total translations loaded: {len(T)}")

# Recursively translate
def translate(obj, path=""):
    if isinstance(obj, dict):
        return {k: translate(v, f"{path}.{k}" if path else k) for k, v in obj.items()}
    if isinstance(obj, list):
        return [translate(item, f"{path}[{i}]") for i, item in enumerate(obj)]
    if isinstance(obj, str):
        return T.get(path, obj)
    return obj

result = translate(en)

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

# Verify key count
def count_keys(obj, prefix=""):
    count = 0
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            count += count_keys(v, p)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            count += count_keys(item, f"{prefix}[{i}]")
    elif isinstance(obj, str):
        count = 1
    return count

total = count_keys(result)
print(f"Total string values in output: {total}")

# Count untranslated (still English)
untranslated = 0
def check_untranslated(en_obj, it_obj, path=""):
    global untranslated
    if isinstance(en_obj, dict) and isinstance(it_obj, dict):
        for k in en_obj:
            if k in it_obj:
                check_untranslated(en_obj[k], it_obj[k], f"{path}.{k}" if path else k)
    elif isinstance(en_obj, list) and isinstance(it_obj, list):
        for i in range(min(len(en_obj), len(it_obj))):
            check_untranslated(en_obj[i], it_obj[i], f"{path}[{i}]")
    elif isinstance(en_obj, str) and isinstance(it_obj, str):
        if en_obj == it_obj and len(en_obj) > 3:
            untranslated += 1

check_untranslated(en, result)
print(f"Untranslated strings (same as English, >3 chars): {untranslated}")
print(f"Written to {out_path}")