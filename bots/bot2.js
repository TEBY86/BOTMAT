const puppeteer = require('puppeteer-extra'); // Importa Puppeteer con soporte para plugins
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Plugin para evitar detección como bot
require('dotenv').config(); // Carga variables de entorno desde .env


puppeteer.use(StealthPlugin()); // Aplica el plugin de stealth para evitar bloqueos en el sitio


function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}


async function bot2(ctx, input) {
  // ¡IMPORTANTE! La declaración de 'log' DEBE estar al principio de la función bot2
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);


  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());


  // --- DEBUG LOGS: Valores de entrada ---
  log(`DEBUG: Input recibido: "${input}"`);
  log(`DEBUG: Región: "${region}", Comuna: "${comuna}", Calle: "${calle}", Número: "${numero}"`);
  log(`DEBUG: Torre: "${torre}", Depto: "${depto}"`);
  // --- FIN DEBUG LOGS ---


  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }


  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');


  async function tomarCapturaBuffer(page) {
    await page.waitForTimeout(1000);
    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Haciendo clic en la lupa para confirmar selección...');
      await lupa.click();
      await page.waitForTimeout(4000);
    }
    return await page.screenshot({ fullPage: true });
  }

let browser;
try {
  // 🧠 Cambia esto según tu entorno:
  // - false → entorno local (abre navegador)
  // - 'new' → entorno de servidor (Render, Railway, etc.)
  const modoHeadless = 'new'; // cambia a false (sin comillas) para entorno local

  browser = await puppeteer.launch({
    headless: modoHeadless, // acepta 'new' o false
    slowMo: 20,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  );


    // --- Añadir listeners para depuración de carga de página ---
    page.on('console', (msg) => log(`[PAGE CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`));
    page.on('pageerror', (err) => log(`[PAGE ERROR] ${err.message}`));
    page.on('response', (response) => log(`[PAGE RESPONSE] URL: ${response.url()} | Status: ${response.status()}`));
    page.on('error', (err) => log(`[BROWSER ERROR] ${err.message}`));
    // --- Fin de listeners ---


    try {
      const response = await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2/', { waitUntil: 'load', timeout: 120000 });
      log('✅ Navegando a la página de inicio de sesión de WOM.');
      if (response) {
        log(`DEBUG: Estado de la respuesta de navegación: ${response.status()} - ${response.url()}`);
      } else {
        log('DEBUG: La navegación no devolvió una respuesta (posiblemente caché o error de red muy temprano).');
      }
    } catch (navigationError) {
      log(`❌ ERROR DE NAVEGACIÓN: No se pudo cargar la página de WOM. Detalles: ${navigationError.message}`);
      await ctx.reply('❌ Error al cargar la página de WOM. Por favor, verifica la URL o tu conexión a internet.');
      try {
        const errorScreenshotBuffer = await page.screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: errorScreenshotBuffer }, { caption: 'Captura de pantalla al fallar la navegación inicial.' });
        log('✅ Captura de pantalla tomada al fallar la navegación inicial.');
      } catch (screenshotError) {
        log(`⚠️ No se pudo tomar captura de pantalla al fallar la navegación: ${screenshotError.message}`);
      }
      if (browser) await browser.close();
      return;
    }


    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await Promise.all([
      page.click('#kc-login'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);


    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
    await page.click('#Button_Opcion_Top_Fact_Tec');
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');


    await page.waitForSelector('input#direccion', { visible: true });
    const inputDireccion = await page.$('input#direccion');
    await inputDireccion.click({ clickCount: 3 });
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(500);


    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;


    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForTimeout(2000);
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(1500);


    const opcionesVisibles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('ul.opciones li')).map(el => el.textContent.trim()).filter(Boolean);
    });


    let mensajeOpciones = '';
    opcionesVisibles.forEach((opcion, index) => {
      mensajeOpciones += `${index + 1}. ${opcion}\n`;
    });
    if (mensajeOpciones.length > 0) {
      await ctx.reply(`📋 Opciones desplegadas por el sistema:\n${mensajeOpciones}`);
    } else {
      await ctx.reply('⚠️ No se detectaron opciones visibles en el desplegable.');
    }


    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);


    let seleccionada = false;
    for (const opcion of posiblesOpciones) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (texto.toUpperCase().includes(calle.toUpperCase()) && texto.toUpperCase().includes(numero.toUpperCase())) {
        const box = await opcion.boundingBox();
        if (box) {
          await ctx.reply(`🟢 Dirección encontrada: ${texto}`);
          await opcion.scrollIntoView();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);
          seleccionada = true;
          break;
        }
      }
    }


    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
      await lupa.click();
      await page.waitForTimeout(2500);


      try {
        await page.waitForSelector('div.drop_down', { visible: true, timeout: 8000 });
        const opcionesExtra = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('div.drop_down .item-content')).map(el => el.textContent.trim()).filter(Boolean);
        });


        if (opcionesExtra.length > 0) {
          console.log('📦 Opciones torre/depto disponibles:');
          opcionesExtra.forEach((texto, idx) => {
            console.log(`${idx + 1}. ${texto}`);
          });
        } else {
          console.log('⚠️ No se detectaron opciones adicionales tras la lupa.');
        }
      } catch (e) {
        console.warn('⌛ Panel de opciones de torre/depto no apareció a tiempo.');
        await ctx.reply('⚠️ No se detectó el segundo panel después de la lupa.');
      }
    }


    const opcionesFinales = await page.$$('div.drop_down .item-content');
    let opcionSeleccionadaFinal = false;


    const etiquetasTorre = ['TORRE', 'BLOCK', 'EDIFICIO'];
    const torreLetra = torre?.split(' ').pop()?.toUpperCase();
    const deptoNumero = depto;


    for (const opcion of opcionesFinales) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (!texto) continue;


      const textoUpper = texto.toUpperCase();


      // --- MODIFICACIÓN AQUÍ: Lógica de coincideTorre más precisa usando Regex ---
      let coincideTorre = false;
      if (torre && torreLetra) {
          // Construir la expresión regular para buscar la palabra completa "TORRE X", "BLOCK X", "EDIFICIO X"
          // '\\b' es un límite de palabra. 'i' hace la regex insensible a mayúsculas/minúsculas,
          // aunque ya estamos usando textoUpper.
          const towerRegex = new RegExp(`\\bTORRE\\s*${torreLetra}\\b|\\bBLOCK\\s*${torreLetra}\\b|\\bEDIFICIO\\s*${torreLetra}\\b`, 'i');
         
          // --- NUEVOS DEBUG LOGS PARA COMPARACIÓN DE TORRE ---
          log(`DEBUG: Comparando Torre:`);
          log(`DEBUG:   textoUpper (opción): "${textoUpper}"`);
          log(`DEBUG:   torreLetra (input): "${torreLetra}"`);
          log(`DEBUG:   Regex usada: ${towerRegex}`);
         
          const regexTestResult = towerRegex.test(textoUpper); // Almacenar el resultado del test
          log(`DEBUG:   Resultado del test Regex para Torre: ${regexTestResult}`); // Nuevo log
          // --- FIN NUEVOS DEBUG LOGS ---


          if (regexTestResult) { // Usar el resultado almacenado
              coincideTorre = true;
          }
      } else if (!torre) {
          // Si no se proporcionó torre, se considera que coincide con cualquier opción de torre
          coincideTorre = true;
      }
      // --- FIN MODIFICACIÓN ---


      const coincideDepto = depto && textoUpper.includes(deptoNumero.toUpperCase());


      log(`DEBUG: Evaluando opción (Torre/Depto): "${texto}"`);
      log(`DEBUG: Coincide Torre (input "${torre}", letra "${torreLetra}"): ${coincideTorre}`);
      log(`DEBUG: Coincide Depto (input "${deptoNumero}"): ${coincideDepto}`);


      if ((torre && !coincideTorre) || (depto && !coincideDepto)) {
        log(`DEBUG: Opción "${texto}" no coincide con los criterios de Torre/Depto. Saltando.`);
        continue;
      }


      await opcion.scrollIntoView();
      log(`DEBUG: Elemento "${texto}" desplazado a la vista.`);


      const box = await opcion.boundingBox();
      if (box) {
        await ctx.reply(`🏢 Seleccionando torre/depto: ${texto}`);
       
        await opcion.click();
        log(`DEBUG: Intento de clic estándar en opción: "${texto}"`);


        await page.waitForTimeout(1500);


        try {
          await page.waitForSelector('div.drop_down', { hidden: true, timeout: 5000 });
          log('DEBUG: Modal de selección de dirección ha desaparecido.');
        } catch (waitError) {
          log(`WARNING: Modal de selección de dirección NO desapareció después del clic. Detalles: ${waitError.message}`);
          await page.evaluate(el => el.click(), opcion);
          log(`DEBUG: Intento de clic con JavaScript en opción: "${texto}"`);
          await page.waitForTimeout(1500);
          try {
             await page.waitForSelector('div.drop_down', { hidden: true, timeout: 5000 });
             log('DEBUG: Modal de selección de dirección ha desaparecido después del clic JS.');
          } catch (jsClickWaitError) {
              log(`WARNING: Modal de selección de dirección NO desapareció incluso con clic JS. Detalles: ${jsClickWaitError.message}`);
          }
        }


        opcionSeleccionadaFinal = true;
        log(`✅ Torre/Depto "${texto}" seleccionada.`);
        break;
      }
    }


    if (!opcionSeleccionadaFinal && opcionesFinales.length > 0) {
      const primera = opcionesFinales[0];
      const box = await primera.boundingBox();
      if (box) {
        const textoPrimeraOpcion = await page.evaluate(el => el.textContent.trim(), primera);
        await ctx.reply(`ℹ️ No se encontró una coincidencia exacta para Torre/Depto. Seleccionando primera opción visible por defecto: ${textoPrimeraOpcion}`);
       
        await primera.scrollIntoView();
        await primera.click();
        await page.waitForTimeout(1500);


        try {
          await page.waitForSelector('div.drop_down', { hidden: true, timeout: 5000 });
          log('DEBUG: Modal de selección de dirección ha desaparecido (primera opción).');
        } catch (waitError) {
          log(`WARNING: Modal de selección de dirección NO desapareció después de seleccionar la primera opción. Detalles: ${waitError.message}`);
        }


        log(`✅ Seleccionada la primera opción por defecto: "${textoPrimeraOpcion}".`);
      }
    } else if (!opcionSeleccionadaFinal && opcionesFinales.length === 0) {
      await ctx.reply('❌ No se encontraron opciones de torre/depto para seleccionar.');
      log('❌ No se encontraron opciones de torre/depto para seleccionar.');
    }


    try {
      await page.waitForSelector('section.modal_cnt.container-row', { visible: true, timeout: 15000 });
      const modal = await page.$('section.modal_cnt.container-row');
      const buffer = await modal.screenshot();
      await ctx.replyWithPhoto({ source: buffer });
      await ctx.reply('📸 Captura del resultado tomada correctamente.');
      log('✅ Captura del modal de resultado tomada.');
    } catch (e) {
      log('⚠️ Modal de resultado no detectado o no apareció a tiempo. Se tomará pantalla completa.');
      console.error('Error al esperar o tomar captura del modal de resultado:', e);
      const buffer = await tomarCapturaBuffer(page);
      await ctx.replyWithPhoto({ source: buffer });
    }


  } catch (e) {
    console.error('❌ Error general:', e);
    await ctx.reply('⚠️ Error inesperado. Intenta nuevamente o revisa los datos.');
  } finally {
    if (browser) await browser.close();
  }
}


module.exports = { bot2 }
