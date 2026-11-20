from pipeline.clients.gdelt import _parse_gdelt_payload


def test_parse_empty_body():
    assert _parse_gdelt_payload("") is None
    assert _parse_gdelt_payload("   ") is None


def test_parse_invalid_json():
    assert _parse_gdelt_payload("not json") is None


def test_parse_valid_json():
    data = _parse_gdelt_payload('{"articles": [{"title": "x", "url": "https://a"}]}')
    assert data is not None
    assert len(data["articles"]) == 1