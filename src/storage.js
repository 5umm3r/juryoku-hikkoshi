/* localStorage wrapper: every access can throw (private mode, blocked storage). */
(function (root) {
  'use strict';
  var PREFIX = 'juryoku-hikkoshi.';
  function get(key, fallback) {
    try {
      var raw = root.localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function set(key, value) {
    try {
      root.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  root.Store = { get: get, set: set };
})(typeof self !== 'undefined' ? self : this);
