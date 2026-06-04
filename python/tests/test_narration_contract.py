"""Parity tests for loom_engine.narration_contract (mirror tests/narration-contract.test.ts).

Run: python python/tests/test_narration_contract.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from loom_engine.narration_contract import (  # noqa: E402
    parse_number_word, extract_candidate_numbers, find_invented_number,
    is_narration_grounded, RESOURCE_NARRATION_CONTRACT,
)

PASS = 0
FAIL = 0


def ck(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label)


ck("RESOURCE key", RESOURCE_NARRATION_CONTRACT == "narrationContract")

ck("parse seven", parse_number_word("seven") == 7)
ck("parse twenty", parse_number_word("twenty") == 20)
ck("parse twenty-one", parse_number_word("twenty-one") == 21)
ck("parse twenty one", parse_number_word("twenty one") == 21)
ck("parse ninety-nine", parse_number_word("ninety-nine") == 99)
ck("parse banana None", parse_number_word("banana") is None)

ck("extract numerals + words", extract_candidate_numbers("you roll 18 and take 7 damage") == [18, 7])
ck("extract words folded", extract_candidate_numbers("seven damage, a total of twenty-one") == [7, 21])
ck("extract 1,024", extract_candidate_numbers("1,024 gold pieces") == [1024])
ck("extract none", extract_candidate_numbers("no numbers here") == [])

ck("grounded numeral", find_invented_number("Your blade bites for 7 damage.", [7]) is None)
ck("invented numeral", find_invented_number("Your blade bites for 9 damage.", [7]) == 9)
ck("grounded number-word", find_invented_number("You take seven damage.", [7]) is None)
ck("invented number-word", find_invented_number("You take eight damage.", [7]) == 8)

attested = [18, 15, 7]
ck("full attested exchange grounded",
   is_narration_grounded("You roll 18 against DC 15 and deal 7 damage.", attested) is True)
ck("one stray invented",
   find_invented_number("You roll 18 against DC 15 and deal twenty-one damage.", attested) == 21)

ck("small flavor ignored", find_invented_number("Two guards block the door.", []) is None)
ck("floor=0 scrutinizes", find_invented_number("Two guards block the door.", [], 0) == 2)

print("\npassed=%d failed=%d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
