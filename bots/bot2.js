// Importa Puppeteer con soporte para plugins
const puppeteer = require('puppeteer-extra');
// Plugin para evitar detección como bot
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// Carga variables de entorno desde .env (ej: WOM_USER, WOM_PASS)
require('dotenv').config();

// Aplica el plugin de stealth para evitar bloqueos en el sitio
puppeteer.use(StealthPlugin());

// La función 'contieneDepartamento' no se utiliza en 'bot2'.
// Si no es necesaria, se puede eliminar para limpiar el código.
// Si tiene un propósito futuro, se podría mantener pero documentar su uso.
function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

/**
 * Función principal del bot para consultar factibilidad técnica en WOM.
 * @param {object} ctx - Contexto del bot (ej: para enviar respuestas).
 * @param {string} input - Cadena de entrada con los datos de la dirección (ej: "Región, Comuna, Calle, Número[, Torre[, Depto]]").
 */
async function bot2(ctx, input) {
  // ¡IMPORTANTE! La declaración de 'log' DEBE estar al principio de la función bot2
  // para que esté disponible en todo el ámbito de la función.
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  // Divide la entrada en sus componentes, eliminando espacios extra.
  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  // --- DEBUG LOGS: Valores de entrada ---
  log(`DEBUG: Input recibido: "${input}"`);
  log(`DEBUG: Región: "${region}", Comuna: "${comuna}", Calle: "${calle}", Número: "${numero}"`);
  log(`DEBUG: Torre: "${torre}", Depto: "${depto}"`);
  // --- FIN DEBUG LOGS ---

  // Valida que los campos mínimos requeridos estén presentes.
  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  /**
   * Toma una captura de pantalla de la página y la devuelve como un buffer.
   * Incluye una lógica para hacer clic en una lupa si está presente, lo que sugiere
   * que esta función se usa a menudo después de una interacción que podría requerir confirmación.
   * @param {Page} page - Instancia de la página de Puppeteer.
   * @returns {Buffer} - Buffer de la captura de pantalla.
   */
  async function tomarCapturaBuffer(page) {
    await page.waitForTimeout(1000); // Espera un poco para asegurar que la página se estabilice
    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Haciendo clic en la lupa para confirmar selección...');
      const box = await lupa.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await lupa.click(); // Fallback si no se puede obtener el bounding box
      }
      await page.waitForTimeout(4000); // Espera más tiempo después de hacer clic en la lupa
    }
    return await page.screenshot({ fullPage: true });
  }

  let browser;
  try {
    // Lanza una nueva instancia del navegador.
    // 'headless: false' es útil para depuración visual.
    // 'slowMo' ralentiza las operaciones para una mejor observación.
    // 'args' son importantes para entornos sin sandbox (ej: Docker, CI/CD).
    browser = await puppeteer.launch({
      headless: false, // Cambiar a 'true' para producción
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1366, height: 900 },
    });

    const page = await browser.newPage();
    // Establece un User-Agent para simular un navegador real y evitar detecciones.
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    // --- Añadir listeners para depuración de carga de página ---
    // Estos listeners son muy útiles para entender qué sucede en el navegador.
    page.on('console', (msg) => log(`[PAGE CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`));
    page.on('pageerror', (err) => log(`[PAGE ERROR] ${err.message}`));
    page.on('response', (response) => log(`[PAGE RESPONSE] URL: ${response.url()} | Status: ${response.status()}`));
    page.on('error', (err) => log(`[BROWSER ERROR] ${err.message}`));
    // --- Fin de listeners ---

    // Navega a la página de inicio de sesión de WOM.
    try {
      // 'waitUntil: 'load'' espera que el evento 'load' de la página se dispare.
      // Para SPAs, 'networkidle2' o 'networkidle0' pueden ser más fiables
      // para asegurar que todo el contenido dinámico ha cargado.
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
      // Intenta tomar una captura incluso si la navegación falla para depuración.
      try {
        const errorScreenshotBuffer = await page.screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: errorScreenshotBuffer }, { caption: 'Captura de pantalla al fallar la navegación inicial.' });
        log('✅ Captura de pantalla tomada al fallar la navegación inicial.');
      } catch (screenshotError) {
        log(`⚠️ No se pudo tomar captura de pantalla al fallar la navegación: ${screenshotError.message}`);
      }
      if (browser) await browser.close();
      return; // Termina la ejecución si la navegación inicial falla.
    }

    // Rellena las credenciales de inicio de sesión.
    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);

    // Hace clic en el botón de inicio de sesión y espera la navegación completa.
    // Se simula un clic humano moviendo el ratón y haciendo clic.
    const loginButton = await page.$('#kc-login');
    if (loginButton) {
      const box = await loginButton.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await Promise.all([
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
      } else {
        // Fallback al click directo si no se puede obtener el bounding box
        await Promise.all([
          loginButton.click(),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
      }
    } else {
      log('ERROR: Botón de inicio de sesión no encontrado.');
      await ctx.reply('❌ No se pudo encontrar el botón de inicio de sesión.');
      if (browser) await browser.close();
      return;
    }


    // Espera a que el botón de "Factibilidad Técnica" esté visible y haz clic en él.
    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
    const factibilidadButton = await page.$('#Button_Opcion_Top_Fact_Tec');
    if (factibilidadButton) {
      const box = await factibilidadButton.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await factibilidadButton.click(); // Fallback
      }
    }
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    // --- INICIO DE INTEGRACIÓN DEL NUEVO CÓDIGO ---

    // Espera a que al menos un input#direccion esté presente y visible.
    await page.waitForSelector('input#direccion', { visible: true });
    const allInputsDireccion = await page.$$('input#direccion'); // Obtiene todos los inputs con ese ID

    let inputDireccion;
    // Itera sobre los inputs para encontrar el que está visible y es interactuable.
    for (let i = 0; i < allInputsDireccion.length; i++) {
      const visible = await allInputsDireccion[i].evaluate(el => {
        const style = window.getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.offsetHeight > 0 // Asegura que el elemento tiene altura y no está colapsado
        );
      });
      if (visible) {
        inputDireccion = allInputsDireccion[i];
        log(`DEBUG: Se encontró un input#direccion visible en el índice ${i}.`);
        break; // Sale del bucle una vez que se encuentra el input visible
      }
    }

    if (!inputDireccion) {
      // Si no se encontró ningún input visible, lanza un error.
      log('ERROR: No se encontró un input visible para escribir la dirección.');
      throw new Error('❌ No se encontró un input visible para escribir la dirección.');
    }

    // Borra el contenido existente en el campo de dirección.
    // Se simula un clic humano para seleccionar el texto.
    const inputDireccionBox = await inputDireccion.boundingBox();
    if (inputDireccionBox) {
      await page.mouse.move(inputDireccionBox.x + inputDireccionBox.width / 2, inputDireccionBox.y + inputDireccionBox.height / 2);
      await page.mouse.click(inputDireccionBox.x + inputDireccionBox.width / 2, inputDireccionBox.y + inputDireccionBox.height / 2, { clickCount: 3 }); // Triple clic para seleccionar todo
    } else {
      await inputDireccion.click({ clickCount: 3 }); // Fallback si no se puede obtener el bounding box
    }
    await inputDireccion.press('Backspace'); // Borra el texto seleccionado
    await page.waitForTimeout(500); // Pequeña espera para que el DOM se actualice

    // Formatea la calle si la región es "LIBERTADOR BERNARDO O'HIGGINS".
    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    // Escribe la calle y el número en el campo de dirección.
    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForTimeout(2000); // Espera a que el autocompletado aparezca
    await inputDireccion.press('Backspace'); // A veces, un backspace ayuda a disparar el autocompletado
    await page.waitForTimeout(1500); // Espera un poco más para las opciones

    // Obtiene y muestra las opciones de autocompletado visibles.
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

    // 🔍 Buscar opciones que contienen la calle y el número.
    // Se utiliza XPath para buscar elementos por su texto.
    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let seleccionada = false;
    const direccionEsperada = `${calleFormateada} ${numero}`.toUpperCase(); // Usar calleFormateada aquí

    for (const [index, opcion] of posiblesOpciones.entries()) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      const detalles = await page.evaluate(el => {
        return {
          texto: el.textContent.trim(),
          html: el.innerHTML,
          clase: el.className,
          tipo: el.tagName
        };
      }, opcion);

      console.log(`🔍 Detalles de la opción ${index + 1}:`, detalles); // Log de depuración detallado

      const textoUpper = texto.toUpperCase();
      const calleUpper = calleFormateada.toUpperCase(); // Usar calleFormateada aquí
      const numeroUpper = numero.toUpperCase();

      // ✅ Validar que contenga calle y número
      if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {

        // 🛠️ Scroll manual dentro del contenedor (si aplica)
        // Este bloque asume que existe un contenedor específico para las opciones de autocompletado.
        // Si el sitio web no tiene un contenedor de desplazamiento explícito, este código no tendrá efecto.
        await page.evaluate((textToFind) => {
          const items = Array.from(document.querySelectorAll('.item-content')); // Ajustar selector si es necesario
          const contenedor = document.querySelector('section.drop_down'); // Ajustar selector si es necesario
          const target = items.find(el => el.textContent.trim() === textToFind);
          if (target && contenedor) {
            // Desplaza el contenedor para que el elemento objetivo quede 100px por debajo del borde superior
            contenedor.scrollTop = target.offsetTop - 100;
            console.log(`DEBUG: Contenedor desplazado para mostrar "${textToFind}".`);
          }
        }, texto); // Pasa el texto de la opción actual al contexto del navegador

        // Desplaza el elemento a la parte superior de la vista para simular un scroll humano.
        // Se usa 'center' para asegurar que la opción esté bien visible en el centro de la vista.
        await opcion.scrollIntoView({ block: 'center' });
        log(`DEBUG: Elemento "${texto}" desplazado a la vista (centro del bloque).`);
        await page.waitForTimeout(500); // Pequeña espera para que el scroll se complete

        const box = await opcion.boundingBox();

        if (box) {
          await ctx.reply(`🟢 Dirección exacta encontrada: ${texto}`);
          console.log(`✅ Seleccionando dirección exacta: ${texto}`);
          // Simula un clic humano en la opción.
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);

          // ✅ Luego hacer clic en lupa (si aparece después de seleccionar la dirección principal)
          // Esto asume que la lupa es el mismo elemento que la primera lupa o una nueva que aparece.
          const lupaAfterAddressSelection = await page.$('label.input_icon--left.icono-lupa');
          if (lupaAfterAddressSelection) {
            await ctx.reply('🔎 Confirmando la dirección con clic en la lupa (después de selección de calle/número)...');
            const lupaBox = await lupaAfterAddressSelection.boundingBox();
            if (lupaBox) {
              await page.mouse.move(lupaBox.x + lupaBox.width / 2, lupaBox.y + lupaBox.height / 2);
              await page.mouse.click(lupaBox.x + lupaBox.width / 2, lupaBox.y + lupaBox.height / 2);
            } else {
              await lupaAfterAddressSelection.click(); // Fallback
            }
            await page.waitForTimeout(2500); // Espera a que aparezcan las opciones de torre/depto
            log('DEBUG: Clic en lupa después de seleccionar dirección principal.');
          } else {
            log('DEBUG: No se encontró lupa después de seleccionar la dirección principal.');
          }

          seleccionada = true;
          break; // Sale del bucle una vez que se selecciona una opción
        }
      }
    }

    // --- FIN DE INTEGRACIÓN DEL NUEVO CÓDIGO (PRIMERA PARTE) ---

    // El bloque de la lupa que estaba aquí (después del primer bucle de opciones)
    // ahora ha sido movido DENTRO del bucle de selección de dirección principal,
    // ya que el nuevo snippet sugiere que se hace clic en la lupa inmediatamente después.
    // Por lo tanto, este bloque se elimina o se comenta si no es necesario.
    /*
    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
      const box = await lupa.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await lupa.click(); // Fallback
      }
      await page.waitForTimeout(2500); // Espera a que aparezcan las opciones de torre/depto

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
    */

    // Si la dirección principal no fue seleccionada, el flujo podría haber fallado aquí.
    if (!seleccionada) {
      await ctx.reply('❌ No se encontró una opción de dirección que coincida con la calle y número proporcionados.');
      log('❌ No se encontró una opción de dirección que coincida con la calle y número proporcionados.');
      // Opcional: Tomar captura de pantalla aquí para depuración
      const errorScreenshotBuffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: errorScreenshotBuffer }, { caption: 'Captura de pantalla al no encontrar dirección principal.' });
      if (browser) await browser.close();
      return;
    }


    // Selecciona la opción final de torre/depto.
    // Este bloque sigue siendo relevante después de la selección de la dirección principal
    // y el posible clic en la lupa que revela estas opciones.
    const opcionesFinales = await page.$$('div.drop_down .item-content');
    let opcionSeleccionadaFinal = false;

    // Extrae la letra de la torre si se proporcionó.
    const torreLetra = torre?.split(' ').pop()?.toUpperCase();
    const deptoNumero = depto;

    for (const opcion of opcionesFinales) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (!texto) continue; // Salta si el texto está vacío

      const textoUpper = texto.toUpperCase();

      let coincideTorre = false;
      if (torre && torreLetra) {
        // Expresión regular para buscar "TORRE X", "BLOCK X", "EDIFICIO X" (insensible a mayúsculas/minúsculas).
        // '\\b' asegura que coincida con la palabra completa.
        const towerRegex = new RegExp(`\\bTORRE\\s*${torreLetra}\\b|\\bBLOCK\\s*${torreLetra}\\b|\\bEDIFICIO\\s*${torreLetra}\\b`, 'i');

        log(`DEBUG: Comparando Torre:`);
        log(`DEBUG:   textoUpper (opción): "${textoUpper}"`);
        log(`DEBUG:   torreLetra (input): "${torreLetra}"`);
        log(`DEBUG:   Regex usada: ${towerRegex}`);

        const regexTestResult = towerRegex.test(textoUpper);
        log(`DEBUG:   Resultado del test Regex para Torre: ${regexTestResult}`);

        if (regexTestResult) {
          coincideTorre = true;
        }
      } else if (!torre) {
        // Si no se proporcionó torre en la entrada, se considera que coincide con cualquier opción de torre.
        // Esto es útil si la dirección no tiene torre explícitamente.
        coincideTorre = true;
      }

      // Verifica si el departamento coincide.
      const coincideDepto = depto && textoUpper.includes(deptoNumero.toUpperCase());

      log(`DEBUG: Evaluando opción (Torre/Depto): "${texto}"`);
      log(`DEBUG: Coincide Torre (input "${torre}", letra "${torreLetra}"): ${coincideTorre}`);
      log(`DEBUG: Coincide Depto (input "${deptoNumero}"): ${coincideDepto}`);

      // Si se proporcionó torre o depto y no hay coincidencia, salta esta opción.
      if ((torre && !coincideTorre) || (depto && !coincideDepto)) {
        log(`DEBUG: Opción "${texto}" no coincide con los criterios de Torre/Depto. Saltando.`);
        continue;
      }

      // Si llega aquí, la opción coincide o no se especificaron torre/depto.
      // Desplaza el elemento a la parte superior de la vista para simular un scroll humano.
      await opcion.scrollIntoView({ block: 'start' });
      log(`DEBUG: Elemento "${texto}" desplazado a la vista (inicio del bloque).`);

      const box = await opcion.boundingBox();
      if (box) {
        await ctx.reply(`🏢 Seleccionando torre/depto: ${texto}`);

        // Simula un clic humano en la opción.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        log(`DEBUG: Intento de clic humano en opción: "${texto}"`);

        await page.waitForTimeout(1500); // Pequeña espera después del clic

        try {
          // Espera a que el modal de selección de dirección desaparezca.
          await page.waitForSelector('div.drop_down', { hidden: true, timeout: 5000 });
          log('DEBUG: Modal de selección de dirección ha desaparecido.');
        } catch (waitError) {
          log(`WARNING: Modal de selección de dirección NO desapareció después del clic. Detalles: ${waitError.message}`);
          // Si el clic normal no funcionó, intenta un clic con JavaScript como fallback.
          await page.evaluate(el => el.click(), opcion);
          log(`DEBUG: Intento de clic con JavaScript en opción (fallback): "${texto}"`);
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
        break; // Sale del bucle una vez que se selecciona una opción
      }
    }

    // Si no se encontró una coincidencia exacta para torre/depto, selecciona la primera opción disponible.
    if (!opcionSeleccionadaFinal && opcionesFinales.length > 0) {
      const primera = opcionesFinales[0];
      const box = await primera.boundingBox();
      if (box) {
        const textoPrimeraOpcion = await page.evaluate(el => el.textContent.trim(), primera);
        await ctx.reply(`ℹ️ No se encontró una coincidencia exacta para Torre/Depto. Seleccionando primera opción visible por defecto: ${textoPrimeraOpcion}`);

        // Desplaza el elemento a la parte superior de la vista para simular un scroll humano.
        await primera.scrollIntoView({ block: 'start' });
        log(`DEBUG: Primera opción "${textoPrimeraOpcion}" desplazada a la vista (inicio del bloque).`);
        // Simula un clic humano en la primera opción.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
      // Si no hay opciones finales para seleccionar.
      await ctx.reply('❌ No se encontraron opciones de torre/depto para seleccionar.');
      log('❌ No se encontraron opciones de torre/depto para seleccionar.');
    }

    // Intenta tomar una captura del modal de resultado final.
    try {
      // Espera a que el modal de resultado sea visible.
      await page.waitForSelector('section.modal_cnt.container-row', { visible: true, timeout: 15000 });
      const modal = await page.$('section.modal_cnt.container-row');
      const buffer = await modal.screenshot(); // Toma captura solo del modal
      await ctx.replyWithPhoto({ source: buffer });
      await ctx.reply('📸 Captura del resultado tomada correctamente.');
      log('✅ Captura del modal de resultado tomada.');
    } catch (e) {
      log('⚠️ Modal de resultado no detectado o no apareció a tiempo. Se tomará pantalla completa.');
      console.error('Error al esperar o tomar captura del modal de resultado:', e);
      // Si el modal no aparece, toma una captura de pantalla completa como fallback.
      const buffer = await tomarCapturaBuffer(page);
      await ctx.replyWithPhoto({ source: buffer });
    }

  } catch (e) {
    // Captura cualquier error inesperado durante la ejecución del bot.
    console.error('❌ Error general:', e);
    await ctx.reply('⚠️ Error inesperado. Intenta nuevamente o revisa los datos.');
  } finally {
    // Asegura que el navegador se cierre siempre, incluso si ocurre un error.
    if (browser) await browser.close();
    log('✅ Navegador cerrado.');
  }
}

module.exports = { bot2 };
