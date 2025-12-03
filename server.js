// server.js
const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs'); // <-- Módulo para manejar archivos

// --- CONFIGURACIÓN ---
// NOTA: Estas variables ahora se leerán desde las variables de entorno de Render
// para mayor seguridad.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8549907358:AAGF_RFJ45DQc0KwyQZB4aHKFyNVtY_Mi-o';
// Aseguramos que el chat_id sea un número, no un string
const TELEGRAM_GROUP_CHAT_ID = Number(process.env.TELEGRAM_GROUP_CHAT_ID);
const COSTO_QUemar = 10; // Créditos para publicar a un infiel
const COSTO_VER_CHISME = 2; // Créditos para ver el chisme completo
// --- FIN DE LA CONFIGURACIÓN ---

// --- BASE DE DATOS CON PERSISTENCIA EN ARCHIVO JSON ---
const DB_FILE = '/var/data/database.json';
// --- FUNCIÓN PARA SINCRONIZAR LA BASE DE DATOS ---
function syncDatabaseWithMaster() {
    const masterPath = path.join(__dirname, 'database-master.json');
    const serverPath = DB_FILE; // Esta variable ya existe en tu código

    if (fs.existsSync(masterPath)) {
        try {
            const masterData = fs.readFileSync(masterPath, 'utf8');
            fs.writeFileSync(serverPath, masterData, 'utf8');
            console.log('✅ Base de datos sincronizada con database-master.json');
        } catch (error) {
            console.error('❌ Error al sincronizar la base de datos:', error);
        }
    } else {
        console.log('⚠️ No se encontró database-master.json. No se sincronizó la base de datos.');
    }
}

// Función para cargar la base de datos desde el archivo
function loadDatabase() {
    const masterPath = path.join(__dirname, 'database-master.json');

    // 1. PRIORIDAD MÁXIMA: Si existe el archivo maestro, úsalo para sobreescribir la base de datos del servidor.
    if (fs.existsSync(masterPath)) {
        try {
            console.log('🔧 Encontrado database-master.json. Sincronizando la base de datos...');
            const masterData = fs.readFileSync(masterPath, 'utf8');
            fs.writeFileSync(DB_FILE, masterData, 'utf8');
            console.log('✅ Base de datos del servidor actualizada desde el maestro.');
            // Ahora que el archivo del servidor está bien, léelo y devuélvelo.
            return JSON.parse(masterData);
        } catch (error) {
            console.error('❌ Error fatal al usar el archivo maestro:', error);
            // Si ni el maestro funciona, no podemos arrancar.
            process.exit(1); // Detiene la aplicación
        }
    }

    // 2. Si NO hay archivo maestro, intenta cargar el del servidor (el comportamiento antiguo).
    console.log('⚠️ No se encontró database-master.json. Intentando cargar la base de datos local del servidor...');
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('❌ Error fatal al leer el archivo de la base de datos del servidor:', error);
            process.exit(1); // El archivo está roto y no hay maestro para arreglarlo. Detenemos la app.
        }
    }

    // 3. Si no hay nada, devuelve la estructura inicial.
    console.log('⚠️ No se encontró ningún archivo de base de datos. Creando una nueva...');
    return { nextUserId: 1, nextPostId: 1, nextRecargaId: 1, users: {}, posts: {}, pendingPayments: {}, pendingRecargas: {} };
}

// Función para guardar la base de datos en el archivo
function saveDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Cargar la base de datos al inicio
let db = loadDatabase();

// Atajos para no tener que cambiar todo el código existente
let users = db.users;
let posts = db.posts;
let pendingPayments = db.pendingPayments;
let pendingRecargas = db.pendingRecargas;
// --- FIN DE LA BASE DE DATOS ---

// INICIO DE LA APLICACIÓN EXPRESS (DEBE ESTAR DESPUÉS DE CARGAR LAS VARIABLES Y LA DB)
const app = express();
app.use(express.json({
    limit: '10mb'
}));
app.use(express.static(__dirname));
// FIN DEL INICIO DE EXPRESS

// --- FUNCIONES AUXILIARES ---
async function sendTelegramAlert(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_GROUP_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log("Alerta enviada al grupo de Telegram.");
    } catch (error) {
        console.error('Error enviando alerta a Telegram:', error.response ? error.response.data : error.message);
    }
}

function findUserById(userId) {
    return users[userId];
}
// --- FIN DE FUNCIONES AUXILIARES ---

// --- RUTAS DE AUTENTICACIÓN ---
app.post('/api/auth/register', async (req, res) => {
    console.log(">>> PETICIÓN RECIBIDA EN /api/auth/register");
    const {
        username,
        password
    } = req.body;
    if (!username || !password) {
        return res.status(400).json({
            ok: false,
            message: 'Usuario y contraseña son obligatorios.'
        });
    }
    if (Object.values(users).find(u => u.username === username)) {
        return res.status(409).json({
            ok: false,
            message: 'Ese nombre de usuario ya está en uso.'
        });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'user_' + db.nextUserId++;
    users[userId] = {
        id: userId,
        username,
        passwordHash,
        credits: 0
    };
    saveDatabase(); // <-- GUARDAR CAMBIO
    console.log("Usuario '" + username + "' registrado con ID " + userId + "."); // <-- CORREGIDO
    res.json({
        ok: true,
        message: 'Usuario creado con éxito.'
    });
});

app.post('/api/auth/login', async (req, res) => {
    console.log(">>> PETICIÓN RECIBIDA EN /api/auth/login");
    const {
        username,
        password
    } = req.body;
    const user = Object.values(users).find(u => u.username === username);
    if (!user) {
        console.log("Login fallido: usuario no encontrado");
        return res.status(401).json({
            ok: false,
            message: 'Usuario o contraseña incorrectos.'
        });
    }
    const isValid = await bcrypt.compare(password, String(user.passwordHash));
    if (!isValid) {
        console.log("Login fallido: contraseña incorrecta");
        return res.status(401).json({
            ok: false,
            message: 'Usuario o contraseña incorrectos.'
        });
    }
    console.log("Usuario '" + user.username + "' inició sesión."); // <-- CORREGIDO
    res.json({
        ok: true,
        message: 'Inicio de sesión exitoso.',
        user: {
            id: user.id,
            username: user.username,
            credits: user.credits
        }
    });
});
// --- FIN DE RUTAS DE AUTENTICACIÓN ---

// --- NUEVAS RUTAS DE RECARGA ---
app.post('/api/solicitar-recarga', async (req, res) => {
    const {
        userId,
        creditos
    } = req.body;
    if (!userId || !creditos || creditos <= 0) {
        return res.status(400).json({
            ok: false,
            message: 'Datos de recarga inválidos.'
        });
    }
    const user = findUserById(userId);
    if (!user) {
        return res.status(404).json({
            ok: false,
            message: 'Usuario no encontrado.'
        });
    }
    const monto = creditos * 1.0; // 1 sol por crédito
    const recargaId = 'rec_' + db.nextRecargaId++;
    pendingRecargas[recargaId] = {
        userId,
        creditos,
        monto
    };
    saveDatabase(); // <-- GUARDAR CAMBIO
    console.log("Solicitud de recarga para " + creditos + " créditos (S/ " + monto + ") por usuario " + user.username + " (Recarga ID: " + recargaId + ")."); // <-- CORREGIDO
    res.json({
        ok: true,
        message: 'Solicitud de recarga generada.',
        recargaId,
        monto
    });
});

app.post('/api/registrar-pago-recarga', async (req, res) => {
    const {
        recargaId
    } = req.body;
    const recarga = pendingRecargas[recargaId];
    if (!recarga) {
        return res.status(400).json({
            ok: false,
            message: 'Solicitud de recarga no encontrada.'
        });
    }
    const user = findUserById(recarga.userId);
    if (!user) {
        return res.status(404).json({
            ok: false,
            message: 'Usuario asociado a la recarga no encontrado.'
        });
    }
    const mensaje = `💰 <b>NUEVA SOLICITUD DE RECARGA</b> 💰\n\n<b>Usuario:</b> <i>${user.username}</i>\n<b>Créditos a añadir:</b> <b>${recarga.creditos}</b>\n<b>Monto pagado:</b> S/ ${recarga.monto}\n<b>ID de la Recarga:</b> <code>${recargaId}</code>\n\n<b>¿APROBAR RECARGA?</b> /approve_recarga_${recargaId}\n\n<b>¿RECHAZAR?</b> /reject_recarga_\${recargaId}`; // <-- ¡LÍNEA CORREGIDA (1 de 4)!
    await sendTelegramAlert(mensaje);
    console.log("Notificación de recarga " + recargaId + " enviada a Telegram."); // <-- CORREGIDO
    res.json({
        ok: true,
        message: 'Pago de recarga registrado. El administrador ha sido notificado.'
    });
});
// --- FIN DE RUTAS DE RECARGA ---

// --- RUTAS DE LA APLICACIÓN ---
app.post('/api/solicitar-quemada', async (req, res) => {
    const {
        userId,
        nombre,
        redes,
        edad,
        origen,
        evidencias,
        fotoBase64
    } = req.body;
    if (!userId || !nombre) {
        return res.status(400).json({
            ok: false,
            message: 'Faltas datos del usuario o del infiel.'
        });
    }
    const user = findUserById(userId);
    if (!user) {
        return res.status(404).json({
            ok: false,
            message: 'Usuario no encontrado.'
        });
    }
    if (user.credits < COSTO_QUemar) {
        return res.status(400).json({
            ok: false,
            message: `Créditos insuficientes. Necesitas \${COSTO_QUemar} y tienes ${user.credits}.` // <-- ¡LÍNEA CORREGIDA (2 de 4)!
        });
    }
    const postId = 'post_' + db.nextPostId++;
    posts[postId] = {
        id: postId,
        userId,
        nombre,
        redes,
        edad,
        origen,
        evidencias,
        fotoBase64,
        fechaCreacion: new Date().toISOString(),
        estado: 'PENDIENTE_VALIDACION'
    };
    saveDatabase(); // <-- GUARDAR CAMBIO
    console.log("Solicitud de quemada para '" + nombre + "' recibida (Post ID: " + postId + ")."); // <-- CORREGIDO
    res.json({
        ok: true,
        message: 'Solicitud recibida. Ahora realiza el pago y espera la validación.',
        postId
    });
});

app.post('/api/registrar-pago-yape', async (req, res) => {
    const {
        postId,
        monto
    } = req.body;
    const post = posts[postId];
    if (!post || post.estado !== 'PENDIENTE_VALIDACION') {
        return res.status(400).json({
            ok: false,
            message: 'Solicitud no encontrada o ya procesada.'
        });
    }
    const paymentId = 'pay_' + Date.now() + '_' + postId;
    pendingPayments[paymentId] = {
        postId,
        monto
    };
    saveDatabase(); // <-- GUARDAR CAMBIO
    const mensaje = `🔥 <b>NUEVO PAGO YAPE RECIBIDO</b> 🔥\n\n<b>Nombre del Infiel:</b> <i>${post.nombre}</i>\n<b>Monto:</b> S/ ${monto}\n<b>ID de la Solicitud:</b> <code>${postId}</code>\n\n<b>¿APROBAR?</b> /approve_${paymentId}\n\n<b>¿RECHAZAR?</b> /reject_${paymentId}`;
    await sendTelegramAlert(mensaje);
    res.json({
        ok: true,
        message: 'Pago registrado. El administrador ha sido notificado.'
    });
});

// <-- ¡NUEVA RUTA AÑADIDA AQUÍ! -->
app.post('/api/publicar-directo', async (req, res) => {
    const { userId, nombre, redes, edad, origen, evidencias, fotoBase64 } = req.body;
    if (!userId || !nombre) {
        return res.status(400).json({ ok: false, message: 'Faltas datos del usuario o del infiel.' });
    }
    const user = findUserById(userId);
    if (!user) {
        return res.status(404).json({ ok: false, message: 'Usuario no encontrado.' });
    }

    // Verificación de seguridad en el servidor
    if (user.credits < COSTO_QUemar) {
        return res.status(400).json({ ok: false, message: 'Fraude detectado. Créditos insuficientes.' });
    }

    // Descontamos créditos en el servidor también
    user.credits -= COSTO_QUemar;

    const postId = 'post_' + db.nextPostId++;
    posts[postId] = {
        id: postId, userId, nombre, redes, edad, origen, evidencias, fotoBase64,
        fechaCreacion: new Date().toISOString(),
        estado: 'PUBLICADO', // <-- SE PUBLICA DIRECTAMENTE
        fechaPago: new Date().toISOString() // <-- La fecha de "pago" es ahora
    };
    saveDatabase();
    console.log("✅ Post '" + nombre + "' PUBLICADO DIRECTAMENTE por " + user.username + ".");

    // Notificamos al admin de todas formas, para que esté al tanto
    const mensaje = `✅ <b>NUEVO POST PUBLICADO DIRECTAMENTE</b> ✅\n\n<b>Usuario:</b> <i>${user.username}</i>\n<b>Nombre del Infiel:</b> <i>${nombre}</i>\n<b>ID del Post:</b> <code>${postId}</code>\n\nCréditos descontados.`;
    await sendTelegramAlert(mensaje);

    res.json({ 
        ok: true, 
        message: 'Post publicado exitosamente.',
        userCredits: user.credits // <-- ¡LÍNEA AÑADIDA!
    });
});
// <-- ¡FIN DE LA ADICIÓN! -->

app.post('/api/telegram-webhook', async (req, res) => {
    const message = req.body.message;
    if (!message || !message.text || message.chat.id != TELEGRAM_GROUP_CHAT_ID) return res.sendStatus(200);
    const text = message.text;

    // --- Lógica para aprobar/rechazar posts ---
    if (text.startsWith('/approve_') && !text.includes('recarga')) {
        const paymentId = text.split('_')[1];
        const payment = pendingPayments[paymentId];
        if (payment) {
            const post = posts[payment.postId];
            const user = findUserById(post.userId);
            if (post.estado === 'PENDIENTE_VALIDACION') {
                post.estado = 'PUBLICADO';
                post.fechaPago = new Date().toISOString();
                user.credits -= COSTO_QUemar;
                saveDatabase(); // <-- GUARDAR CAMBIO
                console.log("✅ Post " + post.id + " PUBLICADO."); // <-- CORREGIDO
                await sendTelegramAlert(`✅ Pago <b>${paymentId}</b> APROBADO. Post de <i>\${post.nombre}</i> publicado.`); // <-- ¡LÍNEA CORREGIDA (3 de 4)!
            }
            delete pendingPayments[paymentId];
            saveDatabase(); // <-- GUARDAR CAMBIO
        }
    } else if (text.startsWith('/reject_') && !text.includes('recarga')) {
        const paymentId = text.split('_')[1];
        if (pendingPayments[paymentId]) {
            const payment = pendingPayments[paymentId];
            const post = posts[payment.postId];
            post.estado = 'RECHAZADO';
            saveDatabase(); // <-- GUARDAR CAMBIO
            console.log("❌ Post " + post.id + " RECHAZADO."); // <-- CORREGIDO
            await sendTelegramAlert(`❌ Pago <b>\${paymentId}</b> RECHAZADO.`); // <-- ¡LÍNEA CORREGIDA (4 de 4)!
            delete pendingPayments[paymentId];
            saveDatabase(); // <-- GUARDAR CAMBIO
        }
    }

    // --- Lógica para aprobar/rechazar recargas (VERSIÓN 100% CORREGIDA) ---
    else if (text.startsWith('/approve_recarga_')) {
        let recargaId = text.replace('/approve_recarga_', ''); // <-- ¡LÍNEA MÁGICA! Esto limpia el comando si Telegram le añade @...
        recargaId = recargaId.split('@')[0];
        console.log(">>> Comando de aprobación recibido. Intentando aprobar recarga con ID: " + recargaId); // <-- CORREGIDO
        const recarga = pendingRecargas[recargaId];
        if (recarga) {
            const user = findUserById(recarga.userId);
            if (user) {
                user.credits += recarga.creditos;
                saveDatabase(); // <-- GUARDAR CAMBIO
                console.log("✅ Recarga " + recargaId + " APROBADA. Se añadieron " + recarga.creditos + " créditos al usuario " + user.username + "."); // <-- CORREGIDO
                await sendTelegramAlert(`✅ Recarga <b>${recargaId}</b> APROBADA. El usuario <i>${user.username}</i> ahora tiene \${user.credits} créditos.`); // <-- LÍNEA CORREGIDA (2 de 3)
            } else {
                console.log("❌ Error: Usuario " + recarga.userId + " no encontrado para la recarga " + recargaId + "."); // <-- CORREGIDO
            }
            delete pendingRecargas[recargaId];
            saveDatabase(); // <-- GUARDAR CAMBIO
        } else {
            console.log("❌ Error: Recarga con ID " + recargaId + " no encontrada."); // <-- CORREGIDO
        }
    } else if (text.startsWith('/reject_recarga_')) {
        let recargaId = text.replace('/reject_recarga_', ''); // <-- ¡LÍNEA MÁGICA! Esto limpia el comando si Telegram le añade @...
        recargaId = recargaId.split('@')[0];
        console.log(">>> Comando de rechazo recibido. Intentando rechazar recarga con ID: " + recargaId); // <-- CORREGIDO
        if (pendingRecargas[recargaId]) {
            delete pendingRecargas[recargaId];
            saveDatabase(); // <-- GUARDAR CAMBIO
            console.log("❌ Recarga " + recargaId + " RECHAZADA."); // <-- CORREGIDO
            await sendTelegramAlert(`❌ Recarga <b>\${recargaId}</b> RECHAZADA.`); // <-- LÍNEA CORREGIDA
        } else {
            console.log("❌ Error: Recarga con ID " + recargaId + " no encontrada para rechazar."); // <-- CORREGIDO
        }
    }
    res.sendStatus(200);
});

app.post('/api/posts/detalles', async (req, res) => {
    const {
        postId,
        userId
    } = req.body;
    if (!postId || !userId) {
        return res.status(400).json({
            ok: false,
            message: 'Faltas datos.'
        });
    }
    const user = findUserById(userId);
    if (!user) {
        return res.status(404).json({
            ok: false,
            message: 'Usuario no encontrado.'
        });
    }
    if (user.credits < COSTO_VER_CHISME) {
        return res.status(400).json({
            ok: false,
            message: `Créditos insuficientes. Necesitas \${COSTO_VER_CHISME} para ver el chisme.` // <-- ¡LÍNEA CORREGIDA (3 de 3)!
        });
    }
    const post = posts[postId];
    if (!post || post.estado !== 'PUBLICADO') {
        return res.status(404).json({
            ok: false,
            message: 'Confesión no encontrada.'
        });
    }
    user.credits -= COSTO_VER_CHISME;
    saveDatabase(); // <-- GUARDAR CAMBIO
    console.log("Usuario " + user.username + " gastó " + COSTO_VER_CHISME + " créditos para ver el post " + postId + "."); // <-- CORREGIDO
    res.json({ 
        ok: true, 
        post: post,
        userCredits: user.credits // <-- ¡LÍNEA AÑADIDA!
    });
});

app.get('/api/muro-publico', (req, res) => {
    const publicPosts = Object.values(posts)
        .filter(p => p.estado === 'PUBLICADO')
        .sort((a, b) => new Date(b.fechaPago) - new Date(a.fechaPago))
        .map(p => ({
            id: p.id,
            nombre: p.nombre
        }));
    res.json({
        ok: true,
        posts: publicPosts
    });
});
// --- FIN DE RUTAS DE LA APLICACIÓN ---


// --- Middleware de errores (DEBE ESTAR AL FINAL) ---
app.post('/api/admin/borrar-post', (req, res) => {
    const { postId, userId } = req.body;

    // 1. Verificar que el usuario sea el administrador (jandirxd)
    const user = findUserById(userId);
    if (!user || user.username !== 'jandirxd') {
        return res.status(403).json({ ok: false, message: 'No tienes permiso para realizar esta acción.' });
    }

    // 2. Verificar que el post exista
    if (!posts[postId]) {
        return res.status(404).json({ ok: false, message: 'Publicación no encontrada.' });
    }

    // 3. Borrar el post
    const nombrePostBorrado = posts[postId].nombre;
    delete posts[postId];
    saveDatabase(); // Guardar los cambios en la base de datos

    console.log(`🔥 POST BORRADO por el admin (${user.username}): "${nombrePostBorrado}" (ID: \${postId})`);

    res.json({ ok: true, message: 'Publicación borrada con éxito.' });
});
// --- FIN DE RUTA DE ADMINISTRADOR ---

/*
// --- CÓDIGO DE PRUEBA (solo se ejecuta si no hay posts) ---
if (Object.keys(posts).length === 0) {
    const ejemploPostId = 'post_' + db.nextPostId++;
    posts[ejemploPostId] = { id: ejemploPostId, userId: 'user_0', // Un ID de usuario ficticio
        nombre: "El Cacherito de San Miguel", redes: "@cachero_miguelino_99", edad: "28", origen: "Lima - San Miguel", evidencias: "Le encontré mensajes con 'la amiguita especial' en su Instagram guardado. ¡El colmo de la traición!", fotoBase64: "https://i.imgur.com/8pXhL1u.jpeg", fechaCreacion: new Date().toISOString(), estado: 'PUBLICADO', fechaPago: new Date().toISOString()
    };
    saveDatabase(); // <-- GUARDAR CAMBIO
    console.log("✅ Post de ejemplo creado: " + posts[ejemploPostId].nombre + " (ID: " + ejemploPostId + ")"); // <-- CORREGIDO
}
// --- FIN DEL CÓDIGO DE PRUEBA ---
*/


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🔥 Quema Infiel corriendo en http://localhost:" + PORT); // <-- CORREGIDO
});