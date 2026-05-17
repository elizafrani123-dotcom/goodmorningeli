// Front-end config. Edit tickers here to change your portfolio.
window.DASHBOARD_CONFIG = {
  userName: "Eli",
  tickers: [
    "QQQ","UAL","SPY","XLK","AMD","AMZN","TSLA","IVW","VOOG","GOOGL",
    "VOO","VTI","QQQM","NVDA","AAPL","RCL","PYPL","AXP","JPM","SFL",
    "DIA","Z","WIX","SLI","CTXR"
  ],
  refreshIntervals: {
    weather: 15 * 60 * 1000,   // 15 min
    stocks:  60 * 1000,        //  1 min
    news:    10 * 60 * 1000,   // 10 min
    calendar: 5 * 60 * 1000,   //  5 min
    inbox:   5 * 60 * 1000     //  5 min
  },
  newsCategories: ["Top", "Geopolitics", "Israel", "US", "Tech", "Markets"],
  weatherUnits: "imperial" // imperial or metric
};
