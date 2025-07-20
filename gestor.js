// GESTOR.js (CONTENIDO FINAL CORREGIDO)

// ✅ ahora si
// — versión funcional con GPT y validación JSON

require('dotenv').config(); // Carga variables de entorno para GESTOR.js
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');
// Importa la función bot2 desde el archivo bot2.js
// Las declaraciones de puppeteer, StealthPlugin y dotenv deben estar en bot2.js, no aquí.
const { bot2 } = require('./bots/bot2'); 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Telegraf( process.env.BOT_TOKEN );

console.log('[GESTOR] Bot inicializando...'); // Log de inicio

bot.command('admin', async (ctx) => {
  console.log('[GESTOR] Comando /admin recibido.'); // Log de comando
  await ctx.reply(`✏️ Instrucciones:

1️⃣ Escribe primero el comando:
- /factibilidad → Verifica en base local si la dirección existe (más seguro).
- /forzar → Envía la dirección directo al sistema WOM, sin validación previa.

2️⃣ Luego ingresa la dirección en este formato:

🌎 Región, 🏙️ Comuna, 🛣️ Calle XXX, 🔢 Número XXX [, 🏢 Torre/Piso XXX] [, 📦 Depto XXX]

✅ Ejemplos:
- /factibilidad Libertador Bernardo O'Higgins, Rancagua, Calle XXX, Número XXX
- /forzar Metropolitana, Santiago, Calle XXX, Número XXX, Torre XXX, Depto XXX

📌 Separa cada dato con comas ( , ).`);
});


function normalizarTexto(texto) {
  return texto.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function calcularDistanciaLevenshtein(a, b) {
  const matriz = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matriz[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + costo
      );
    }
  }
  return matriz[a.length][b.length];
}

function obtenerSugerencias(direccionBuscada, listaDirecciones, limite = 3) {
  const similitudes = listaDirecciones.map(dir => {
    const dirNormal = normalizarTexto(dir);
    const distancia = calcularDistanciaLevenshtein(direccionBuscada, dirNormal);
    return { direccion: dir, distancia };
  });

  return similitudes
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, limite)
    .map(s => s.direccion);
}

function verificarDireccion(_regionNoUsar, comunaInput, direccionInput) {
  const archivoComuna = comunaInput.normalize("NFD").replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '_');
  const rutaArchivo = path.resolve(__dirname, 'comunas', archivoComuna + '.json');
  console.log(`📂 Buscando archivo: ${rutaArchivo}`);

  if (!fs.existsSync(rutaArchivo)) {
    console.log('❌ Archivo no encontrado');
    return { error: `⚠️ No se encontró la comuna "${comunaInput}".` };
  }

  const json = JSON.parse(fs.readFileSync(rutaArchivo));
  const regionExtraida = json.region || 'Región desconocida';
  const direcciones = json.direcciones || [];
  const listaNormalizada = direcciones.map(dir => typeof dir === 'string' ? normalizarTexto(dir) : normalizarTexto(dir.direccion));

  const direccionSoloHastaNumero = direccionInput.split(/torre|depto|dpto|piso|block/i)[0].trim();
  const variantes = [normalizarTexto(direccionSoloHastaNumero)];

  console.log('🔄 Variantes generadas:');
  variantes.forEach(v => console.log(`→ ${v}`));

  let direccionEncontrada = null;
  const existe = variantes.some(variacion => {
    for (let i = 0; i < listaNormalizada.length; i++) {
      if (listaNormalizada[i].includes(variacion)) {
        direccionEncontrada = typeof direcciones[i] === 'string' ? direcciones[i] : direcciones[i].direccion;
        console.log(`🔍 Coincidencia encontrada: "${direccionEncontrada}"`);
        return true;
      }
    }
    return false;
  });

  if (existe) {
    const rutaArchivoJSON = path.join(__dirname, 'shared', 'direccion.json');
    fs.mkdirSync(path.dirname(rutaArchivoJSON), { recursive: true });
    fs.writeFileSync(rutaArchivoJSON, JSON.stringify({ direccion: `/factibilidad ${regionExtraida}, ${comunaInput}, ${direccionEncontrada}` }));
    console.log(`✅ Dirección guardada: /factibilidad ${regionExtraida}, ${comunaInput}, ${direccionEncontrada}`);

    return {
      ok: true,
      region: regionExtraida,
      comuna: comunaInput,
      calle: direccionEncontrada.split(' ').slice(0, -1).join(' '),
      numero: direccionEncontrada.split(' ').slice(-1)[0],
      direccion: direccionEncontrada
    };
  } else {
    const sugerencias = obtenerSugerencias(normalizarTexto(direccionInput), direcciones.map(dir => typeof dir === 'string' ? dir : dir.direccion));
    return {
      ok: false,
      mensaje: `🚫 Dirección no encontrada en ${comunaInput}.
` + (sugerencias.length ? `📌 Sugerencias:
- ${sugerencias.join('\n- ')}` : 'Sin coincidencias cercanas.')
    };
  }
}

// 🧠 Procesar dirección con GPT
async function procesarDireccionIA(texto) {
  console.log(`[GESTOR] Procesando dirección con IA: "${texto}"`); // Log de IA
  texto = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, ' ').trim();

  const prompt = `Analiza cuidadosamente la siguiente dirección escrita libremente por un usuario.

Extrae únicamente los siguientes campos:
- comuna (obligatorio, prioridad principal)
- calle (obligatorio)
- número (obligatorio)
- región (si está explícitamente escrita en el texto, inclúyela; si no, deja "")
- torre (si está explícitamente escrita, inclúyela; si no, deja "")
- depto (si está explícitamente escrita, inclúyela; si no, deja "")

El texto puede venir en cualquier orden.

Importante:
- No inventes datos.
- No asumas datos.
- No completes región, comuna, calle, número, torre o depto si no están explícitos.
- Si no puedes encontrar comuna, calle o número, responde únicamente:
{ "error": "No se pudo interpretar correctamente la dirección" }

Devuelve siempre un JSON con este formato estricto:
{ "region": "...", "comuna": "...", "calle": "...", "numero": "...", "torre": "...", "depto": "..." }

Dirección: "${texto}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });
    const iaResponseContent = completion.choices[0].message.content;
    console.log(`[GESTOR] Respuesta cruda de IA: ${iaResponseContent}`); // Log de respuesta IA
    return JSON.parse(iaResponseContent);
  } catch (e) {
    console.error('❌ Error detallado al interpretar IA:', e);
    return { error: '❌ Error interpretando dirección con IA. Intenta nuevamente más tarde.' };
  }
}


function guardarJSONLog(data) {
  const ruta = path.join(__dirname, 'logs', `log-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(data, null, 2), 'utf8');
}

bot.command('factibilidad', async (ctx) => {
  console.log(`[GESTOR] Comando /factibilidad recibido. Texto: "${ctx.message.text}"`); // Log de comando
  const inputCrudo = ctx.message.text.replace('/factibilidad', '').trim();
  console.log(`[GESTOR] Input crudo para IA: "${inputCrudo}"`); // Log de input crudo
  
  const iaResultado = await procesarDireccionIA(inputCrudo);
  console.log('[GESTOR] Resultado parseado de IA:', iaResultado); // Log de resultado IA

  if (iaResultado.error) {
    console.log(`[GESTOR] Error de IA: ${iaResultado.error}`); // Log de error IA
    return ctx.reply(iaResultado.error);
  }
  if (!iaResultado.comuna) {
    console.log('[GESTOR] Comuna no encontrada por IA.'); // Log de comuna faltante
    return ctx.reply('⚠️ Faltó la comuna. Revisa que esté bien escrita.');
  }

  const resultado = await verificarDireccion(
    iaResultado.region,
    iaResultado.comuna,
    `${iaResultado.calle} ${iaResultado.numero}`
  );
  console.log('[GESTOR] Resultado de verificación local:', resultado); // Log de verificación local

if (!resultado.ok) {
  await ctx.reply(`⚠️ Dirección no encontrada en base local. Intentando directamente en WOM...`);
} else {
  await ctx.reply(`✅ Dirección verificada: ${resultado.direccion}`);
}

guardarJSONLog({
  usuario: ctx.from,
  entrada_original: inputCrudo,
  analisis_ia: iaResultado,
  verificarDireccion: resultado,
  timestamp: new Date().toISOString()
});

const inputFinal = [
  resultado.region || iaResultado.region,
  resultado.comuna || iaResultado.comuna,
  resultado.calle || iaResultado.calle,
  resultado.numero || iaResultado.numero,
  iaResultado.torre, // Usar torre parseada por IA
  iaResultado.depto  // Usar depto parseado por IA
].filter(Boolean).join(', '); // Filtrar elementos vacíos/undefined antes de unir

console.log('➡️ Input final para bot2:', inputFinal); // Log de input final para bot2

await bot2(ctx, inputFinal);
});

bot.on('text', async (ctx) => {
  console.log(`[GESTOR] Mensaje de texto recibido. Texto: "${ctx.message.text}"`); // Log de texto
  const texto = ctx.message.text.trim().toLowerCase();
  if (texto.startsWith('factibilidad')) {
    ctx.message.text = '/factibilidad' + ctx.message.text.slice('factibilidad'.length);
    console.log(`[GESTOR] Redirigiendo a /factibilidad. Nuevo texto: "${ctx.message.text}"`); // Log de redirección
    return bot.handleUpdate(ctx.update);
  }
  console.log('[GESTOR] Mensaje no es un comando conocido ni "factibilidad". Ignorando.'); // Log de ignorado
});

bot.command('forzar', async (ctx) => {
  console.log(`[GESTOR] Comando /forzar recibido. Texto: "${ctx.message.text}"`); // Log de comando
  const inputCrudo = ctx.message.text.replace('/forzar', '').trim();
  console.log(`[GESTOR] Input crudo para IA (forzar): "${inputCrudo}"`); // Log de input crudo (forzar)

  if (!inputCrudo || inputCrudo.split(',').length < 4) { // Mantener una verificación básica
    console.log('[GESTOR] Formato incorrecto para /forzar.'); // Log de formato incorrecto
    return ctx.reply('⚠️ Usa el formato: /forzar Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  const iaResultado = await procesarDireccionIA(inputCrudo);
  console.log('[GESTOR] Resultado parseado de IA (forzar):', iaResultado); // Log de resultado IA (forzar)

  if (iaResultado.error) {
    console.log(`[GESTOR] Error de IA (forzar): ${iaResultado.error}`); // Log de error IA (forzar)
    return ctx.reply(iaResultado.error);
  }
  if (!iaResultado.comuna) {
    console.log('[GESTOR] Comuna no encontrada por IA (forzar).'); // Log de comuna faltante (forzar)
    return ctx.reply('⚠️ Faltó la comuna. Revisa que esté bien escrita.');
  }

  await ctx.reply(`🚀 Ejecutando forzado directo con dirección:
${inputCrudo}`);

  const inputFinal = [
    iaResultado.region,
    iaResultado.comuna,
    iaResultado.calle,
    iaResultado.numero,
    iaResultado.torre,
    iaResultado.depto
  ].filter(Boolean).join(', ');

  console.log('➡️ Input final para bot2 (forzar):', inputFinal); // Log de input final para bot2 (forzar)

  await bot2(ctx, inputFinal);
});

bot.launch();
console.log('🚀 Bot con IA para factibilidad iniciado.');
