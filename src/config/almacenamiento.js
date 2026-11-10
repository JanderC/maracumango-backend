// Almacenamiento de imágenes en Supabase Storage (reemplaza a Cloudinary).
// Variables de entorno:
//   SUPABASE_URL         https://<proyecto>.supabase.co
//   SUPABASE_SECRET_KEY  clave secreta (sb_secret_… o service_role). Solo en el servidor.
//   SUPABASE_BUCKET      nombre del bucket público donde se guardan las fotos
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config({ quiet: true });

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || '';
const configurado = () => Boolean(URL_BASE && CLAVE && BUCKET);

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024; // el frontend ya reduce la foto a 800 px; esto es solo un tope

const cabeceras = (extra = {}) => ({ apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, ...extra });

// Sube un archivo y devuelve { url, ruta }. "ruta" es lo que se guarda en imagen_public_id.
const subirArchivo = async (carpeta, buffer, mimetype) => {
  if (!configurado()) throw new Error('Supabase Storage no está configurado (faltan variables SUPABASE_*)');
  const ext = TIPOS[mimetype];
  if (!ext) throw new Error('Formato de imagen no permitido (usa JPG, PNG o WEBP)');
  const ruta = `${carpeta}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ 'Content-Type': mimetype, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' }),
    body: buffer
  });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { url: `${URL_BASE}/storage/v1/object/public/${BUCKET}/${ruta}`, ruta };
};

// Borra una imagen por su ruta. Las rutas viejas de Cloudinary (o vacías) se ignoran sin error.
const eliminarImagen = async (ruta) => {
  if (!ruta || !configurado() || !/^(productos|carpetas)\//.test(ruta)) return;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: cabeceras({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [ruta] })
  });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status} al borrar: ${(await r.text()).slice(0, 200)}`);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => (TIPOS[file.mimetype] ? cb(null, true) : cb(new Error('Formato de imagen no permitido (usa JPG, PNG o WEBP)')))
});

// Recibe la imagen del formulario y la sube a Supabase. Si algo falla (servicio caído,
// formato no permitido, etc.) el registro se guarda igual sin cambiar la imagen y la
// respuesta lleva un "aviso". Los demás campos ya llegaron porque la imagen va de última.
// Deja req.file = { path: url pública, filename: ruta } como esperan los controladores.
const subirImagenOpcional = (carpeta = 'productos', campo = 'imagen') => (req, res, next) => {
  const conAviso = (motivo) => {
    console.error('No se pudo subir la imagen:', motivo);
    delete req.file;
    const aviso = 'La imagen no se pudo subir. Se guardó todo lo demás, sin cambiar la imagen.';
    const json = res.json.bind(res);
    res.json = (body) => json(body && typeof body === 'object' && res.statusCode < 400 ? { ...body, aviso } : body);
  };
  upload.single(campo)(req, res, async (err) => {
    if (err) { conAviso(err.message || err); return next(); }
    if (!req.file) return next();
    try {
      const { url, ruta } = await subirArchivo(carpeta, req.file.buffer, req.file.mimetype);
      req.file = { path: url, filename: ruta, mimetype: req.file.mimetype, size: req.file.size };
    } catch (e) { conAviso(e.message); }
    next();
  });
};

module.exports = { subirImagenOpcional, subirArchivo, eliminarImagen, configurado };
