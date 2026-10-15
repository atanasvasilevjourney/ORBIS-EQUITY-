from pipeline.ingest.nasdaq_listed import parse_nasdaq_listed_text


SAMPLE = """Symbol|Security Name|Market Category|ETF|Test Issue|Financial Status|Round Lot Size
NBIS|Nebius Group N.V. - Class A Ordinary Shares|Q|N|N|N|100
ZZZZ|Test Issue Co|Q|N|Y|N|100
File Creation Time: 10/15/2026"""


def test_parse_nasdaq_listed_skips_test_and_footer():
    rows = parse_nasdaq_listed_text(SAMPLE)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "NBIS"
    assert "Nebius" in rows[0]["company_name"]
