// Envuelve controladores async para propagar errores al middleware central
// sin necesidad de try/catch repetido en cada modulo.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
