(function () {
  function getRaw(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function setRaw(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getJson(key, fallback = null) {
    const raw = getRaw(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function setJson(key, value) {
    return setRaw(key, JSON.stringify(value));
  }

  function ensureMarker(key, apply) {
    if (getRaw(key)) return false;
    if (typeof apply === 'function') apply();
    setRaw(key, '1');
    return true;
  }

  window.PinlaneStorage = {
    getRaw,
    setRaw,
    remove,
    getJson,
    setJson,
    ensureMarker,
  };
})();
