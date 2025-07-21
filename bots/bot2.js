const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto) {
  const regex = /\b(TORRE|DEPTO|PISO|CASA|BLOCK|EDIFICIO|[A-F]|\d{1,3})\b/i;
  return regex.test(texto);
}

async function encontrarElemento(page, selectores, timeout = 5000) {
  if (!page) throw new Error('Página no definida');
  for (const selector of selectores) {
    try {
      const elemento = await page.waitForSelector(selector, { visible: true, timeout });
      if (elemento) return elemento;
    } catch (e) {
      continue;
    }
  }
  throw new Error(`No se pudo encontrar el elemento con selectores: ${selectores.join(', ')}`);
}

async function esperaInteligente(page, accion = null, timeout = 10000) {
  if (!page) throw new Error('Página no definida');
  if (accion) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: ['networkidle2', 'domcontentloaded'], timeout }),
      page.waitForFunction(() => document.readyState === 'complete', { timeout }),
      accion()
    ]).catch(() => {});
  }
  
  await page.waitForFunction(() => {
    return !document.querySelector('.loading, .spinner, [aria-busy="true"]');
  }, { timeout }).catch(() => {});
}

async function manejarModalResultados(page, ctx) {
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  if (!page || !ctx) {
    log('Error: page o ctx no definidos');
    return false;
  }
  try {
    await page.waitForFunction(() => {
      const loaders = document.querySelectorAll('.loader, .spinner, .loading');
      return Array.from(loaders).every(loader => loader.style.display === 'none');
    }, { timeout: 10000 });

    const modal = await encontrarElemento(page, [
      'section.modal_cnt.container-row',
      'div[role="dialog"]',
      'div.modal-content',
      'div.result-container'
    ], 15000);

    const buffer = await modal.screenshot({
      clip: await modal.boundingBox()
    });
    
    await ctx.replyWithPhoto({ source: buffer });
    return true;
  } catch (error) {
    log(`Error al manejar modal: ${error.message}`);
    return false;
  }
}

async function bot2(ctx, input) {
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  
  if (!ctx) {
    log('Error: ctx no definido');
    throw new Error('Contexto de Telegram (ctx) no definido');
  }

  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  log(`Input recibido: "${input}"`);
  log(`Región: "${region}", Comuna: "${comuna}", Calle: "${calle}", Número: "${numero}"`);
  log(`Torre: "${torre}", Depto: "${depto}"`);

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  await ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  let browser;
  let page;
  try {
    const modoHeadless = 'new';
    browser = await puppeteer.launch({
      headless: modoHeadless,
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1366, height: 900 },
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    page.on('console', msg => log(`[CONSOLE] ${msg.text()}`));
    page.on('pageerror', error => log(`[ERROR] ${error.message}`));
    page.on('response', response => log(`[RESPONSE] ${response.status()} ${response.url()}`));

    try {
      await esperaInteligente(page, async () => {
        await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2', {
          waitUntil: 'networkidle2',
          timeout: 120000
        });
      });
      log('✅ Página de login cargada');
    } catch (error) {
      log(`❌ Error navegación inicial: ${error.message}`);
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer, caption: 'Error al cargar página inicial' });
      throw error;
    }

    await page.type('#username', process.env.WOM_USER || '');
    await page.type('#password', process.env.WOM_PASS || '');
    await esperaInteligente(page, async () => {
      await page.click('#kc-login');
    });
    log('✅ Credenciales ingresadas');

    await encontrarElemento(page, ['#Button_Opcion_Top_Fact_Tec'], 10000);
    await esperaInteligente(page, async () => {
      await page.click('#Button_Opcion_Top_Fact_Tec');
    });
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    const inputDireccion = await encontrarElemento(page, ['input#direccion'], 8000);
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

    // Manejo de opciones de dirección
    const opcionesVisibles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('ul.opciones li')).map(el => el.textContent.trim()).filter(Boolean);
    });

    if (opcionesVisibles.length > 0) {
      await ctx.reply(`📋 Opciones desplegadas por el sistema:\n${opcionesVisibles.map((o, i) => `${i+1}. ${o}`).join('\n')}`);
    } else {
      await ctx.reply('⚠️ No se detectaron opciones visibles en el desplegable.');
    }

    // Selección de dirección
    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let seleccionada = false;
    for (const opcion of posiblesOpciones) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (texto.toUpperCase().includes(calle.toUpperCase()) && texto.toUpperCase().includes(numero.toUpperCase())) {
        await ctx.reply(`🟢 Dirección encontrada: ${texto}`);
        await opcion.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await esperaInteligente(page, async () => {
          await opcion.click();
        });
        seleccionada = true;
        break;
      }
    }

    if (!seleccionada) {
      log('⚠️ No se encontró coincidencia exacta, intentando fallback con primera opción válida');
      const opciones = await page.$$('ul.opciones li');
      if (opciones.length > 0) {
        const texto = await page.evaluate(el => el.textContent.trim(), opciones[0]);
        if (contieneDepartamento(texto)) {
          await ctx.reply(`⚠️ Fallback: Seleccionando primera opción: ${texto}`);
          await page.evaluate(el => el.click(), opciones[0]);
          seleccionada = true;
        } else {
          throw new Error('No se pudo seleccionar la dirección; primera opción no válida');
        }
      } else {
        throw new Error('No se pudo seleccionar la dirección; no hay opciones disponibles');
      }
    }

    // Confirmación con lupa
    const lupa = await encontrarElemento(page, [
      'label.input_icon--left.icono-lupa',
      'button[aria-label="Buscar"]',
      'div.search-icon'
    ], 8000);

    await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
    await esperaInteligente(page, async () => {
      await lupa.click();
    });
    await page.waitForTimeout(2000); // Espera adicional para que cargue el segundo desplegable

    // Manejo de torre/depto si existen
    if (torre || depto) {
      try {
        const panelTorreDepto = await encontrarElemento(page, [
          'div.drop_down',
          'div.torre-depto-panel',
          'div.extra-options',
          'select.torre-depto',
          'ul.dropdown-menu',
          'div.select-container',
          '[role="listbox"]'
        ], 15000); // Timeout aumentado a 15000 ms

        await page.evaluate((panel) => {
          panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, panelTorreDepto);
        await page.waitForTimeout(500); // Espera para asegurar visibilidad

        const opcionesExtra = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('div.drop_down .item-content, div.torre-depto-panel div.option, select.torre-depto option, ul.dropdown-menu li, div.select-container div, [role="option"]')).map(el => el.textContent.trim()).filter(Boolean);
        });

        if (opcionesExtra.length > 0) {
          log('Opciones torre/depto disponibles:');
          opcionesExtra.forEach((texto, idx) => log(`${idx + 1}. ${texto}`));
          await ctx.reply(`📋 Opciones torre/depto:\n${opcionesExtra.map((o, i) => `${i+1}. ${o}`).join('\n')}`);
        } else {
          await ctx.reply('⚠️ No se detectaron opciones de torre/depto.');
        }

        const torreLetra = torre?.split(' ').pop()?.toUpperCase();
        const deptoNumero = depto;
        let torreDeptoSeleccionada = false;

        for (const opcion of await page.$$('div.drop_down .item-content, div.torre-depto-panel div.option, select.torre-depto option, ul.dropdown-menu li, div.select-container div, [role="option"]')) {
          const texto = await page.evaluate(el => el.textContent.trim(), opcion);
          const textoUpper = texto.toUpperCase();

          const coincideTorre = torreLetra
            ? new RegExp(`\\b(TORRE|BLOCK|EDIFICIO)\\s*${torreLetra}\\b`, 'i').test(textoUpper)
            : true;

          const coincideDepto = deptoNumero
            ? new RegExp(`\\b(DEPTO|DEPARTAMENTO|DTO)\\s*${deptoNumero}\\b`, 'i').test(textoUpper)
            : true;

          if (coincideTorre && coincideDepto) {
            await ctx.reply(`🏢 Seleccionando torre/depto: ${texto}`);
            await page.evaluate((el) => {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              el.click();
            }, opcion);
            await page.waitForTimeout(1000); // Espera para confirmar selección
            torreDeptoSeleccionada = true;
            break;
          }
        }

        if (!torreDeptoSeleccionada && opcionesExtra.length > 0) {
          const primeraOpcion = await page.$('div.drop_down .item-content, div.torre-depto-panel div.option, select.torre-depto option, ul.dropdown-menu li, div.select-container div, [role="option"]');
          if (primeraOpcion) {
            const texto = await page.evaluate(el => el.textContent.trim(), primeraOpcion);
            if (contieneDepartamento(texto)) {
              await ctx.reply(`⚠️ Fallback: Seleccionando primera opción de torre/depto: ${texto}`);
              await page.evaluate(el => el.click(), primeraOpcion);
              await page.waitForTimeout(1000);
              torreDeptoSeleccionada = true;
            }
          }
        }

        if (!torreDeptoSeleccionada) {
          log('⚠️ No se pudo seleccionar torre/depto');
          await ctx.reply('⚠️ No se pudo seleccionar torre/depto automáticamente');
          const buffer = await page.screenshot({ fullPage: true });
          await ctx.replyWithPhoto({ source: buffer, caption: 'Estado del DOM tras intentar cargar el panel de torre/depto' });
        }
      } catch (e) {
        log(`⚠️ Panel de torre/depto no apareció: ${e.message}`);
        await ctx.reply('⚠️ No se detectó panel de torre/depto');
        const buffer = await page.screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: buffer, caption: 'Estado del DOM tras intentar cargar el panel de torre/depto' });
      }
    } else {
      log('No se proporcionaron torre ni depto, continuando con el modal de resultados');
    }

    // Manejo del modal de resultados
    const resultadoModal = await manejarModalResultados(page, ctx);
    if (!resultadoModal) {
      await ctx.reply('⚠️ No se pudo obtener el modal de resultados, mostrando captura completa...');
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer });
    }

    await ctx.reply('✅ Proceso completado');
  } catch (error) {
    log(`❌ Error general: ${error.message}`);
    await ctx.reply(`⚠️ Error: ${error.message}`);
    if (page) {
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer, caption: 'Estado al ocurrir el error' });
    }
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };