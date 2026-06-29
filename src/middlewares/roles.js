const verificarRol = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ mensaje: 'No autenticado' });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ 
        mensaje: `Acceso denegado. Se requiere rol: ${rolesPermitidos.join(' o ')}` 
      });
    }

    next();
  };
};

module.exports = { verificarRol };