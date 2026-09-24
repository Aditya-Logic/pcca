/**
 * Request validation. The same zod schemas are reused on the frontend,
 * so the browser and the server cannot drift apart.
 *
 * Validated output REPLACES req.body / req.query — so a handler can never
 * accidentally read an unvalidated extra field the client smuggled in.
 */
export const validateBody = (schema) => (req, _res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    next(err);
  }
};

export const validateQuery = (schema) => (req, _res, next) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) {
    next(err);
  }
};

export const validateParams = (schema) => (req, _res, next) => {
  try {
    req.params = schema.parse(req.params);
    next();
  } catch (err) {
    next(err);
  }
};
