from pipeline.ema200_scanner.config.loader import load_config


def test_config_lists_nbis_supplement():
    cfg = load_config()
    supp = [str(s).upper() for s in cfg.get("universe", {}).get("supplements") or []]
    assert "NBIS" in supp
