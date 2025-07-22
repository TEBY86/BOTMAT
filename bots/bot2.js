const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

async function encontrarElemento(page, selectores, timeout = 5000) {
  const start = Date.now();
  for (const selector of selectores) {
    try {
      if (selector.startsWith('//')) {
        const [element] = await page.$x(selector);
        if (element) return element;
      } else {
        const element = await page.waitForSelector(selector, { visible: true, timeout: Math.min(timeout, 2000) });
        if (element) return element;
      }
    } catch (_) {}
  }
  const timeSpent = Date.now() - start;
  if (timeSpent < timeout) {
    await page.waitForTimeout(1000);
    return encontrarElemento(page, selectores, timeout - timeSpent);
  }
  throw new Error(`⛔ No se encontró el elemento. Selectores: ${selectores.join(', ')}`);
}

async function esperaInteligente(page, accion = null, timeout = 10000) {
  if (accion) {
    const oldHtml = await page.content();
    await Promise.allSettled([
      accion(),
      page.waitForFunction(
        oldHtml => document.body.innerHTML !== oldHtml,
        { timeout },
        oldHtml
      )
    ]);
  }
  await page.waitForFunction(() => !document.querySelector('.loading, .spinner, [aria-busy="true"]'), { timeout });
}

async function manejarModalResultados(page, ctx) {
  try {
    await page.waitForFunction(() => {
      const titulo = document.querySelector('h2.modal_content_cnt-title');
      return titulo && titulo.innerText.includes('Factibilidad Exitosa');
    }, { timeout: 10000 });

    const modal = await page.$('section.modal_cnt.container-row');
    if (!modal) throw new Error('Modal no encontrado');

    const buffer = await modal.screenshot({ clip: await modal.boundingBox(), quality: 90 });
    await ctx.replyWithPhoto({ source: buffer });
    return true;
  } catch (error) {
    console.error('Error al manejar modal:', error);
    return false;
  }
}

async function seleccionarTorreDepto(page, texto) {
  const articulos = await page.$$('article.item');
  for (let art of articulos) {
    const cc = await page.evaluate(el => el.querySelector('.item-content')?.textContent.trim(), art);
    if (cc && cc.toUpperCase().includes(texto.toUpperCase())) {
      const label = await art.$('label.label_option');
      if (label) {
        await page.evaluate(el => el.click(), label);
        return cc;
      }
    }
  }
  return null;
}

async function bot2(ctx, input) {
  const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);
  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en WOM, un momento...');
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1366, height: 900 },
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0 Safari/537.36');
    page.on('console', msg => log(`[CONSOLE] ${msg.text()}`));
    page.on('pageerror', error => log(`[ERROR] ${error.message}`));

    // Login
    await esperaInteligente(page, async () => {
      await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/...', { waitUntil: 'networkidle2' });
    });
    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await esperaInteligente(page, async () => page.click('#kc-login'));

    // Sección factibilidad
    await encontrarElemento(page, ['#Button_Opcion_Top_Fact_Tec'], 10000);
    await esperaInteligente(page, async () => page.click('#Button_Opcion_Top_Fact_Tec'));
    await ctx.reply('✅ Sección "Factibilidad Técnica" abierta');

    // Buscar dirección
    const inputDireccion = await encontrarElemento(page, ['input#direccion'], 8000);
    await inputDireccion.click({ clickCount: 3 });
    await inputDireccion.press('Backspace');

    const calleFormateada = region.toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForTimeout(1500);

    const items = await page.$$eval('ul.opciones li.opciones-item', els =>
      els.map(el => ({ id: el.id, texto: el.textContent.trim() }))
    );

    const match = items.find(i => i.texto.toUpperCase().includes(`${calleFormateada.toUpperCase()} ${numero}`));
    if (!match) throw new Error('No se encontró dirección sugerida');

    await page.click(`#${match.id}`);
    await ctx.reply(`📍 Dirección seleccionada: ${match.texto}`);

    // Lupa
    const lupa = await encontrarElemento(page, [
      'div.input_icon_wrapper > label.icono-lupa',
      'label.input_icon.icono-lupa',
      'label[class*="icono-lupa"]'
    ], 8000);

    await ctx.reply('🔎 Confirmando la dirección...');
    await esperaInteligente(page, async () => lupa.click());

    // Verificar si el modal aparece directamente
    const modalDirecto = await page.$('section.modal_cnt.container-row');
    if (modalDirecto) {
      await ctx.reply('📦 Resultado detectado inmediatamente tras clic en lupa');
      await manejarModalResultados(page, ctx);
      return;
    }

    // Torre/Depto si es necesario
    if (torre || depto) {
      try {
        await encontrarElemento(page, ['article.item'], 8000);
        const textoBuscar = `${comuna} ${calle} ${torre ?? ''} ${depto ?? ''}`.trim();
        const encontrado = await seleccionarTorreDepto(page, textoBuscar);
        if (encontrado) {
          await ctx.reply(`🏢 Opción seleccionada: ${encontrado}`);
        } else {
          await ctx.reply('⚠️ No se encontró torre/departamento exacto');
        }
      } catch (e) {
        await ctx.reply('⚠️ No se encontraron opciones de torre/departamento');
      }
    }

    // Modal final
    const resultado = await manejarModalResultados(page, ctx);
    if (!resultado) {
      await ctx.reply('⚠️ No se pudo capturar el modal de resultados');
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer });
    }

    await ctx.reply('✅ Proceso completado');
  } catch (error) {
    log(`❌ Error: ${error.message}`);
    await ctx.reply(`⚠️ Error: ${error.message}`);
    if (browser) {
      const pages = await browser.pages();
      if (pages.length > 0) {
        const buffer = await pages[0].screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: buffer, caption: 'Estado al momento del error' });
      }
    }
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };
