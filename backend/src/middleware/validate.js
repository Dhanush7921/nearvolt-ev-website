import { bad } from '../lib/errors.js';
export const validate = (schema, where = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[where]);
  if (!r.success) return next(bad('Some fields are invalid.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
  if (where === 'query') req.q = r.data; else req[where] = r.data;
  next();
};
