# EMA200 touch — event study & walk-forward report

## AMZN (2205 bars, 26 touch events)

### Event study (production params, TOUCH_BOUNCE)
- **n_touch_bounce**: 26
- **fwd_ret_1d_mean**: -0.0011752578926628305
- **fwd_ret_5d_mean**: -0.002885951953052378
- **fwd_ret_10d_mean**: 0.006075454562813198
- **fwd_ret_20d_mean**: 0.01821007590751073
- **mae_20d_mean**: -0.0436599933502505
- **mfe_20d_mean**: 0.05832271173501801

### Baselines
```json
{
  "random": {
    "fwd_ret_1d": 0.0023356392481889443,
    "fwd_ret_5d": 0.009647950993409832,
    "fwd_ret_10d": 0.022785096481209535,
    "fwd_ret_20d": 0.03851472547261529
  },
  "ema150": {
    "n_events": 38,
    "fwd_ret_5d_mean": 0.0016979422439648913
  },
  "ema250": {
    "n_events": 18,
    "fwd_ret_5d_mean": 0.007571084190681334
  }
}
```

### Strategy metrics (long simulation)
- IS Sharpe: -0.396
- OOS Sharpe: -0.225
- Full Sharpe: -0.293
- Buy&hold Sharpe: 0.665
- Trades: {'n_trades': 10, 'hit_rate': 0.0, 'mean_return': -0.02294545901697692, 'median_return': -0.019849925967336146}

### Monte Carlo (trade mean return)
```json
{
  "n_sims": 2000,
  "mean_return_p5": -0.02957588662012172,
  "mean_return_p50": -0.022748104181426143,
  "mean_return_p95": -0.016885759940262913
}
```

## AAPL (2205 bars, 21 touch events)

### Event study (production params, TOUCH_BOUNCE)
- **n_touch_bounce**: 21
- **fwd_ret_1d_mean**: 0.0034314762738837166
- **fwd_ret_5d_mean**: 0.009897716082697204
- **fwd_ret_10d_mean**: 0.004460288117870925
- **fwd_ret_20d_mean**: -0.012815470285268119
- **mae_20d_mean**: -0.06220587019408916
- **mfe_20d_mean**: 0.056755088554569705

### Baselines
```json
{
  "random": {
    "fwd_ret_1d": -0.0041352067724859005,
    "fwd_ret_5d": 0.012875146917716544,
    "fwd_ret_10d": 0.020790681124053308,
    "fwd_ret_20d": 0.030752401785507807
  },
  "ema150": {
    "n_events": 35,
    "fwd_ret_5d_mean": 0.01080148893348012
  },
  "ema250": {
    "n_events": 16,
    "fwd_ret_5d_mean": -0.004539047904304212
  }
}
```

### Strategy metrics (long simulation)
- IS Sharpe: -0.452
- OOS Sharpe: 0.439
- Full Sharpe: -0.154
- Buy&hold Sharpe: 0.951
- Trades: {'n_trades': 9, 'hit_rate': 0.2222222222222222, 'mean_return': -0.013555857234673428, 'median_return': -0.02918938888684164}

### Monte Carlo (trade mean return)
```json
{
  "n_sims": 2000,
  "mean_return_p5": -0.04425495453673641,
  "mean_return_p50": -0.015161573122870852,
  "mean_return_p95": 0.018698611564845546
}
```

## SPY (2205 bars, 12 touch events)

### Event study (production params, TOUCH_BOUNCE)
- **n_touch_bounce**: 12
- **fwd_ret_1d_mean**: -0.0051253697607649236
- **fwd_ret_5d_mean**: -0.01452468231824064
- **fwd_ret_10d_mean**: -0.017645934538999097
- **fwd_ret_20d_mean**: -0.0399118100181872
- **mae_20d_mean**: -0.06344102632848746
- **mfe_20d_mean**: 0.01997795264349129

### Baselines
```json
{
  "random": {
    "fwd_ret_1d": 0.0039043099592823705,
    "fwd_ret_5d": 0.0015624694355845514,
    "fwd_ret_10d": -0.00995254926791217,
    "fwd_ret_20d": -0.019498929403809918
  },
  "ema150": {
    "n_events": 12,
    "fwd_ret_5d_mean": 0.0003940479563489252
  },
  "ema250": {
    "n_events": 14,
    "fwd_ret_5d_mean": 0.011179231027411671
  }
}
```

### Strategy metrics (long simulation)
- IS Sharpe: -0.339
- OOS Sharpe: -0.817
- Full Sharpe: -0.541
- Buy&hold Sharpe: 0.816
- Trades: {'n_trades': 6, 'hit_rate': 0.16666666666666666, 'mean_return': -0.013470485121042763, 'median_return': -0.012402105347860626}

### Monte Carlo (trade mean return)
```json
{
  "n_sims": 2000,
  "mean_return_p5": -0.021312188223142514,
  "mean_return_p50": -0.013470485121042763,
  "mean_return_p95": -0.0058708280842822425
}
```

## QQQ (2205 bars, 8 touch events)

### Event study (production params, TOUCH_BOUNCE)
- **n_touch_bounce**: 8
- **fwd_ret_1d_mean**: -0.002687432115785468
- **fwd_ret_5d_mean**: -0.005072642785527756
- **fwd_ret_10d_mean**: -0.004214273360551177
- **fwd_ret_20d_mean**: -0.005557595274832447
- **mae_20d_mean**: -0.06556037960078454
- **mfe_20d_mean**: 0.056293440280577076

### Baselines
```json
{
  "random": {
    "fwd_ret_1d": -0.0012312977906270978,
    "fwd_ret_5d": -0.00015217272299176965,
    "fwd_ret_10d": -0.005093944260345554,
    "fwd_ret_20d": 0.015284989137636706
  },
  "ema150": {
    "n_events": 16,
    "fwd_ret_5d_mean": -0.0025726823981076993
  },
  "ema250": {
    "n_events": 4,
    "fwd_ret_5d_mean": -0.0023383474335106347
  }
}
```

### Strategy metrics (long simulation)
- IS Sharpe: -0.226
- OOS Sharpe: 0.202
- Full Sharpe: -0.071
- Buy&hold Sharpe: 0.895
- Trades: {'n_trades': 4, 'hit_rate': 0.25, 'mean_return': -0.00800249807888817, 'median_return': -0.016656824789250957}

### Monte Carlo (trade mean return)
```json
{
  "n_sims": 2000,
  "mean_return_p5": -0.038953988518817595,
  "mean_return_p50": -0.00800249807888817,
  "mean_return_p95": 0.022948992361041254
}
```

## NVDA (2205 bars, 7 touch events)

### Event study (production params, TOUCH_BOUNCE)
- **n_touch_bounce**: 7
- **fwd_ret_1d_mean**: -0.00539668838805718
- **fwd_ret_5d_mean**: 0.04014747117791351
- **fwd_ret_10d_mean**: 0.06473858090171603
- **fwd_ret_20d_mean**: 0.05406212521872389
- **mae_20d_mean**: -0.037160019319519004
- **mfe_20d_mean**: 0.128021903264244

### Baselines
```json
{
  "random": {
    "fwd_ret_1d": -0.017877984635881528,
    "fwd_ret_5d": 0.00021986643347745742,
    "fwd_ret_10d": 0.011218064149197016,
    "fwd_ret_20d": -0.001035306636603482
  },
  "ema150": {
    "n_events": 13,
    "fwd_ret_5d_mean": 0.07881352404090144
  },
  "ema250": {
    "n_events": 11,
    "fwd_ret_5d_mean": 0.04741709701847812
  }
}
```

### Strategy metrics (long simulation)
- IS Sharpe: -0.563
- OOS Sharpe: 0.187
- Full Sharpe: -0.090
- Buy&hold Sharpe: 1.126
- Trades: {'n_trades': 4, 'hit_rate': 0.5, 'mean_return': -0.015677918299844162, 'median_return': -0.017229346126230283}

### Monte Carlo (trade mean return)
```json
{
  "n_sims": 2000,
  "mean_return_p5": -0.049394394921671636,
  "mean_return_p50": -0.015677918299844162,
  "mean_return_p95": 0.01648713049559719
}
```
