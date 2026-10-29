// Real, standalone CommonJS module - not sharp, not synthetic-in-spirit
// (a genuine, independent module with no relation to any other test).
function sum(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function mul(a, b) { return a * b; }
module.exports = { sum, sub, mul };
