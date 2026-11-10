const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'maracumango/productos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }]
  }
});

const upload = multer({ storage });

// Sube la imagen si el servicio responde; si falla (cuenta deshabilitada, sin conexión, etc.)
// el registro se guarda igual sin cambiar la imagen y la respuesta lleva un "aviso".
// Los demás campos del formulario ya llegaron porque la imagen se envía de última.
const subirImagenOpcional = (campo = 'imagen') => (req, res, next) => {
  upload.single(campo)(req, res, (err) => {
    if (err) {
      console.error('No se pudo subir la imagen:', err.message || err.error?.message || err);
      delete req.file;
      const aviso = 'La imagen no se pudo subir porque el servicio de imágenes no está disponible. Se guardó todo lo demás, sin cambiar la imagen.';
      const json = res.json.bind(res);
      res.json = (body) => json(body && typeof body === 'object' && res.statusCode < 400 ? { ...body, aviso } : body);
    }
    next();
  });
};

module.exports = { cloudinary, upload, subirImagenOpcional };