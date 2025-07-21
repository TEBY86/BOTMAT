const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

async function encontrarElemento(page, selectores, timeout = 5000) {
  for (const selector of selectores) {
    try {
      const elemento = await page.waitForSelector(selector, { 
        visible: true, 
        timeout 
      });
      if (elemento) return elemento;
    } catch (e) {
      continue;
    }
  }
  throw new Error(`No se pudo encontrar el elemento con selectores: ${selectores.join(', ')}`);
}

async function esperaInteligente(page, accion = null, timeout = 10000) {
  if (accion) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: ['networkidle2', 'domcontentloaded'], timeout }),
      page.waitForFunction(() => document.readyState === 'complete', { timeout }),
      accion()
    ]).catch(() => {});
  }
  
  await page.waitForFunction(() => {
    return !document.querySelector('.loading, .spinner, [aria-busy="true"]');
  }, { timeout });
}

async function manejarModalResultados(page, ctx) {
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

    // SOLUCIÓN AL ERROR: Eliminar el parámetro quality para PNG
    const buffer = await modal.screenshot({ 
      clip: await modal.boundingBox() // Captura sólo el área del modal
    });
    
    await ctx.replyWithPhoto({ source: buffer });
    return true;
  } catch (error) {
    console.error('Error al manejar modal:', error);
    return false;
  }
}

async function bot2(ctx, input) {
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  
  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  log(`Input recibido: "${input}"`);
  log(`Región: "${region}", Comuna: "${comuna}", Calle: "${calle}", Número: "${numero}"`);
  log(`Torre: "${torre}", Depto: "${depto}"`);

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  let browser;
  try {
    const modoHeadless = 'new';
    browser = await puppeteer.launch({
      headless: modoHeadless,
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1366, height: 900 },
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    page.on('console', msg => log(`[CONSOLE] ${msg.text()}`));
    page.on('pageerror', error => log(`[ERROR] ${error.message}`));
    page.on('response', response => log(`[RESPONSE] ${response.status()} ${response.url()}`));

    try {
      await esperaInteligente(page, async () => {
        await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2/', { 
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

    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
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
      ? calle.replace(/LIBERTADOR BERNARDO O['']HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForTimeout(2000);
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(1500);

    const opcionesVisibles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('ul.opciones li')).map(el => el.textContent.trim()).filter(Boolean);
    });

    if (opcionesVisibles.length > 0) {
      await ctx.reply(`📋 Opciones desplegadas por el sistema:\n${opcionesVisibles.map((o, i) => `${i+1}. ${o}`).join('\n')}`);
    } else {
      await ctx.reply('⚠️ No se detectaron opciones visibles en el desplegable.');
    }

    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let seleccionada = false;
    for (const opcion of posiblesOpciones) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (texto.toUpperCase().includes(calle.toUpperCase()) && texto.toUpperCase().includes(numero.toUpperCase())) {
        await ctx.reply(`🟢 Dirección encontrada: ${texto}`);
        await opcion.scrollIntoView();
        await esperaInteligente(page, async () => {
          await opcion.click();
        });
        seleccionada = true;
        break;
      }
    }

    if (!seleccionada) {
      throw new Error('No se pudo seleccionar la dirección');
    }

    const lupa = await encontrarElemento(page, [
      'label.input_icon--left.icono-lupa',
      'button[aria-label="Buscar"]',
      'div.search-icon'
    ], 8000);

    await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
    await esperaInteligente(page, async () => {
      await lupa.click();
    });

    // MANEJO DE TORRE/DEPTO (PARTE QUE FALTABA)
    if (torre || depto) {
      try {
        const panelTorreDepto = await encontrarElemento(page, [
          'div.drop_down',
          'div.torre-depto-panel',
          'div.extra-options'
        ], 10000);

        const opcionesExtra = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('div.drop_down .item-content, div.torre-depto-panel div.option')).map(el => el.textContent.trim()).filter(Boolean);
        });

        if (opcionesExtra.length > 0) {
          log('Opciones torre/depto disponibles:');
          opcionesExtra.forEach((texto, idx) => log(`${idx + 1}. ${texto}`));
        }

        const torreLetra = torre?.split(' ').pop()?.toUpperCase();
        const deptoNumero = depto;

        for (const opcion of await page.$$('div.drop_down .item-content, div.torre-depto-panel div.option')) {
          const texto = await page.evaluate(el => el.textContent.trim(), opcion);
          const textoUpper = texto.toUpperCase();

          const coincideTorre = torreLetra 
            ? new RegExp(`\\bTORRE\\s*${torreLetra}\\b|\\bBLOCK\\s*${torreLetra}\\b|\\bEDIFICIO\\s*${torreLetra}\\b`, 'i').test(textoUpper)
            : true;

          const coincideDepto = deptoNumero 
            ? new RegExp(`\\bDEPTO\\s*${deptoNumero}\\b|\\bDEPARTAMENTO\\s*${deptoNumero}\\b`, 'i').test(textoUpper)
            : true;

          if ((!torreLetra || coincideTorre) && (!deptoNumero || coincideDepto)) {
            await ctx.reply(`🏢 Seleccionando torre/depto: ${texto}`);
            await esperaInteligente(page, async () => {
              await opcion.click();
            });
            break;
          }
        }
      } catch (e) {
        log(`⚠️ Panel de torre/depto no apareció: ${e.message}`);
      }
    }

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
    if (browser) {
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer, caption: 'Estado al ocurrir el error' });
    }
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };