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
  newsCategories: ["Top", "Geopolitics", "Israel", "US", "Tech", "Markets", "Real Estate"],
  weatherUnits: "imperial", // imperial or metric
  // Default saved cities — the user can edit these in "Manage cities".
  defaultSavedCities: [
    { label: "New York, NY, US", lat: 40.7128, lon: -74.0060, isCurrentLocation: false },
    { label: "Miami, FL, US",    lat: 25.7617, lon: -80.1918, isCurrentLocation: false },
    { label: "Tel Aviv, IL",     lat: 32.0853, lon: 34.7818,  isCurrentLocation: false }
  ]
};
