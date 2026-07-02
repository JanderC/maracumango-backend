const pool = require('../../config/db');

// ── Endpoints públicos, sin verificarToken ──────────────────────────────────
// Usados por la pantalla /menu (cliente sin sesión). Solo exponen campos
// seguros para mostrar: nunca costo, tasa_cambio_usada, ids de Cloudinary, etc.

const obtenerProductosMenu = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.precio_final_cop, p.precio_final_usd,
              p.imagen_url, p.tiene_toppings, p.categoria_id,
              c.nombre AS categoria
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = true
       ORDER BY c.nombre, p.nombre`
    );
    res.json({ productos: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo productos del menú:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerProductoMenu = async (req, res) => {
  const { id } = req.params;
  try {
    const producto = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.precio_final_cop, p.precio_final_usd,
              p.imagen_url, p.tiene_toppings, p.categoria_id,
              c.nombre AS categoria
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.id = $1 AND p.activo = true`,
      [id]
    );

    if (producto.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    const toppings = await pool.query(
      `SELECT t.id, t.nombre, t.precio_cop, t.precio_usd, t.precio_bs
       FROM toppings t
       INNER JOIN producto_toppings pt ON t.id = pt.topping_id
       WHERE pt.producto_id = $1 AND t.activo = true`,
      [id]
    );

    res.json({ producto: { ...producto.rows[0], toppings: toppings.rows } });
  } catch (err) {
    console.error('Error obteniendo producto del menú:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerCategoriasMenu = async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, descripcion FROM categorias ORDER BY nombre ASC'
    );
    res.json({ categorias: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo categorías del menú:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

const obtenerToppingsMenu = async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, precio_cop, precio_usd, precio_bs
       FROM toppings
       WHERE activo = true
       ORDER BY nombre ASC`
    );
    res.json({ toppings: resultado.rows });
  } catch (err) {
    console.error('Error obteniendo toppings del menú:', err.message);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

module.exports = {
  obtenerProductosMenu,
  obtenerProductoMenu,
  obtenerCategoriasMenu,
  obtenerToppingsMenu
};