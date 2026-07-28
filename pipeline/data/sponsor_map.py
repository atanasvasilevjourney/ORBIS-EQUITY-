"""Seed data: maps ClinicalTrials.gov sponsor names to stock tickers.

This mapping covers the top pharma/biotech companies in our universe.
The sponsor_ticker_map table is populated from this on first run
and can be manually extended via Supabase.
"""

SPONSOR_TICKER_MAP: list[dict] = [
    # US Big Pharma
    {"sponsor_name": "Pfizer", "ticker": "PFE", "exchange": "NYSE", "aliases": ["Pfizer Inc.", "Pfizer Inc"]},
    {"sponsor_name": "Johnson & Johnson", "ticker": "JNJ", "exchange": "NYSE", "aliases": ["Janssen", "Janssen Research & Development", "Janssen Pharmaceuticals"]},
    {"sponsor_name": "Merck Sharp & Dohme LLC", "ticker": "MRK", "exchange": "NYSE", "aliases": ["Merck Sharp & Dohme Corp.", "Merck & Co., Inc.", "MSD"]},
    {"sponsor_name": "AbbVie", "ticker": "ABBV", "exchange": "NYSE", "aliases": ["AbbVie Inc.", "Allergan"]},
    {"sponsor_name": "Eli Lilly and Company", "ticker": "LLY", "exchange": "NYSE", "aliases": ["Lilly", "Eli Lilly"]},
    {"sponsor_name": "Bristol-Myers Squibb", "ticker": "BMY", "exchange": "NYSE", "aliases": ["Bristol Myers Squibb", "BMS"]},
    {"sponsor_name": "Amgen", "ticker": "AMGN", "exchange": "NASDAQ", "aliases": ["Amgen Inc."]},
    {"sponsor_name": "Gilead Sciences", "ticker": "GILD", "exchange": "NASDAQ", "aliases": ["Gilead"]},
    {"sponsor_name": "Regeneron Pharmaceuticals", "ticker": "REGN", "exchange": "NASDAQ", "aliases": ["Regeneron"]},
    {"sponsor_name": "Vertex Pharmaceuticals Incorporated", "ticker": "VRTX", "exchange": "NASDAQ", "aliases": ["Vertex Pharmaceuticals", "Vertex"]},
    {"sponsor_name": "Moderna, Inc.", "ticker": "MRNA", "exchange": "NASDAQ", "aliases": ["Moderna", "ModernaTX"]},
    {"sponsor_name": "Biogen", "ticker": "BIIB", "exchange": "NASDAQ", "aliases": ["Biogen Inc."]},
    # EU / UK Pharma
    {"sponsor_name": "AstraZeneca", "ticker": "AZN", "exchange": "NASDAQ", "aliases": ["AstraZeneca PLC", "AstraZeneca AB"]},
    {"sponsor_name": "Novartis", "ticker": "NVS", "exchange": "NYSE", "aliases": ["Novartis AG", "Novartis Pharmaceuticals"]},
    {"sponsor_name": "Roche", "ticker": "RHHBY", "exchange": "OTC", "aliases": ["Hoffmann-La Roche", "F. Hoffmann-La Roche"]},
    {"sponsor_name": "Sanofi", "ticker": "SNY", "exchange": "NASDAQ", "aliases": ["Sanofi-Aventis", "Sanofi S.A."]},
    {"sponsor_name": "Novo Nordisk", "ticker": "NVO", "exchange": "NYSE", "aliases": ["Novo Nordisk A/S"]},
    {"sponsor_name": "GlaxoSmithKline", "ticker": "GSK", "exchange": "NYSE", "aliases": ["GSK plc", "GSK Consumer Healthcare"]},
    {"sponsor_name": "Bayer", "ticker": "BAYRY", "exchange": "OTC", "aliases": ["Bayer AG", "Bayer HealthCare"]},
    # US Mid-Cap Biotech
    {"sponsor_name": "BioMarin Pharmaceutical", "ticker": "BMRN", "exchange": "NASDAQ", "aliases": ["BioMarin"]},
    {"sponsor_name": "Alnylam Pharmaceuticals", "ticker": "ALNY", "exchange": "NASDAQ", "aliases": ["Alnylam"]},
    {"sponsor_name": "Incyte Corporation", "ticker": "INCY", "exchange": "NASDAQ", "aliases": ["Incyte"]},
    {"sponsor_name": "Seagen Inc.", "ticker": "SGEN", "exchange": "NASDAQ", "aliases": ["Seattle Genetics"]},
    {"sponsor_name": "BioNTech SE", "ticker": "BNTX", "exchange": "NASDAQ", "aliases": ["BioNTech"]},
    {"sponsor_name": "Ionis Pharmaceuticals, Inc.", "ticker": "IONS", "exchange": "NASDAQ", "aliases": ["Ionis Pharmaceuticals", "Ionis"]},
    {"sponsor_name": "Neurocrine Biosciences", "ticker": "NBIX", "exchange": "NASDAQ", "aliases": ["Neurocrine"]},
    {"sponsor_name": "Exact Sciences Corporation", "ticker": "EXAS", "exchange": "NASDAQ", "aliases": ["Exact Sciences"]},
    {"sponsor_name": "Jazz Pharmaceuticals", "ticker": "JAZZ", "exchange": "NASDAQ", "aliases": ["Jazz"]},
    {"sponsor_name": "Ultragenyx Pharmaceutical", "ticker": "RARE", "exchange": "NASDAQ", "aliases": ["Ultragenyx"]},
]
