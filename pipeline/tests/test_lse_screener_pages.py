from unittest.mock import MagicMock

from pipeline.clients.lse_api import LSEClient


def test_screener_paginates_until_short_page():
    client = LSEClient()
    client.get_screener = MagicMock(side_effect=[[{"symbol": "A"}] * 1000, [{"symbol": "B"}]])
    rows = client.get_all_screener_data()
    assert len(rows) == 1001
    assert client.get_screener.call_count == 2