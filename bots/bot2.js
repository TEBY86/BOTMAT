const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

// Configuración centralizada
const config = {
  loginUrl: process.env.WOM_LOGIN_URL || 'https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2',
  selectors: {
    login: {
      username: '#username',
      password: '#password',
      loginButton: '#kc-login'
    },
    factibilidad: {
      button: '#Button_Opcion_Top_Fact_Tec',
      input: 'input#direccion',
      search: ['label.input_icon--left.icono-lupa', 'button[aria-label="Buscar"]', 'div.search-icon'],
      modal: [
        'section.modal_cnt.container-row',
        'div[role="dialog"]',
        'div.modal-content',
        'div.result-container'
      ]
    }
  },
  timeouts: {
    base: 5000,
    navigation: 120000,
    multiplier: process.env.TIMEOUT_MULTIPLIER || 1
  }
};

function contieneDepartamento(texto) {
  const regex = /\b(TORRE|DEPTO|PISO|CASA|BLOCK|EDIFICIO|[A-F]|\d{1,3})\b/i;
  return regex.test(texto);
}

async function encontrarElemento(page, selectores, timeout = config.timeouts.base, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const selector of selectores) {
      try {
        const elemento = await page.waitForSelector(selector, { visible: true, timeout });
        if (elemento) return elemento;
      } catch (e) {
        if (attempt === retries) continue;
        await page.waitForTimeout(1000);
      }
    }
  }
  throw new Error(`No se pudo encontrar el elemento con selectores: ${selectores.join(', ')}`);
}

async function esperaInteligente(page, accion = null, timeout = config.timeouts.base) {
  if (accion) {
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: ['networkidle2', 'domcontentloaded'], timeout }),
        page.waitForFunction(() => document.readyState === 'complete', { timeout }),
        accion()
      ]);
    } catch (error) {
      console.warn(`Advertencia en esperaInteligente: ${error.message}`);
    }
  }
  
  try {
    await page.waitForFunction(() => {
      return !document.querySelector('.loading, .spinner, [aria-busy="true"]');
    }, { timeout });
  } catch (error) {
    console.warn(`Advertencia al verificar carga completa: ${error.message}`);
  }
}

async function manejarModalResultados(page, ctx) {
  try {
    await page.waitForFunction(() => {
      const loaders = document.querySelectorAll('.loader, .spinner, .loading');
      return Array.from(loaders).every(loader => loader.style.display === 'none');
    }, { timeout: 10000 });

    const modal = await encontrarElemento(page, config.selectors.factibilidad.modal, 15000);
    const buffer = await modal.screenshot({ clip: await modal.boundingBox() });
    await ctx.replyWithPhoto({ source: buffer });
    return true;
  } catch (error) {
    console.error('Error al manejar modal:', error);
    try {
      const buffer = await page.screenshot({ fullPage: true });
      await ctx.replyWithPhoto({ source: buffer, caption: 'Error al capturar modal, screenshot de página completa' });
    } catch (fallbackError) {
      console.error('Error en fallback:', fallbackError);
      await ctx.reply('⚠️ Error al capturar resultados');
    }
    return false;
  }
}

async function seleccionarTorreDepto(page, ctx, torre, depto) {
  try {
    const panel = await page.waitForSelector('div.drop_down, div.torre-depto-panel', {
      visible: true,
      timeout: 10000
    });

    await page.evaluate((panel) => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, panel);

    const opciones = await page.$$eval('div.drop_down .item-content, div.torre-depto-panel div.option', 
      (elements, {torreBuscar, deptoBuscar}) => {
        return elements.map(el => {
          const text = el.textContent.trim().toUpperCase();
          const rect = el.getBoundingClientRect();
          const visible = (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
          );
          
          const matchTorre = torreBuscar 
            ? text.includes(`TORRE ${torreBuscar}`) || 
              text.includes(`BLOCK ${torreBuscar}`) || 
              text.includes(`EDIFICIO ${torreBuscar}`)
            : true;
          
          const matchDepto = deptoBuscar
            ? text.includes(`DEPTO ${deptoBuscar}`) || 
              text.includes(`DEPARTAMENTO ${deptoBuscar}`) || 
              text.includes(`DTO ${deptoBuscar}`)
            : true;

          return {
            element: el,
            text: text,
            visible: visible,
            score: (matchTorre ? 2 : 0) + (matchDepto ? 2 : 0)
          };
        });
      }, 
      { 
        torreBuscar: torre ? torre.split(' ').pop().toUpperCase() : null, 
        deptoBuscar: depto ? depto.toString().toUpperCase() : null 
      }
    );

    const opcionesVisibles = opciones.filter(op => op.visible)
      .sort((a, b) => b.score - a.score);

    if (opcionesVisibles.length === 0) {
      throw new Error('No hay opciones visibles después del scroll');
    }

    const mejorOpcion = opcionesVisibles[0];
    await ctx.reply(`✅ Seleccionando: ${mejorOpcion.text}`);

    await page.evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
      element.click();
    }, mejorOpcion.element);

    await page.waitForTimeout(2000);
    return true;
  } catch (error) {
    console.error('Error en selección:', error);
    await ctx.reply('⚠️ Error al seleccionar, intentando primera opción disponible');
    
    try {
      const primeraOpcion = await page.$('div.drop_down .item-content, div.torre-depto-panel div.option');
      if (primeraOpcion) {
        const texto = await page.evaluate(el => el.textContent.trim(), primeraOpcion);
        if (contieneDepartamento(texto)) {
          await page.evaluate(el => el.click(), primeraOpcion);
          await ctx.reply(`✅ Fallback: Seleccionada primera opción: ${texto}`);
          await page.waitForTimeout(1000);
          return true;
        } else {
          throw new Error('Primera opción no es válida');
        }
      }
      throw new Error('No hay opciones disponibles');
    } catch (fallbackError) {
      console.error('Error en fallback:', fallbackError);
      await ctx.reply('⚠️ No se pudo seleccionar ninguna opción automáticamente');
      return false;
    }
  }
}

async function navigateToLogin(page, url, retries = 2) {
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await esperaInteligente(page, async () => {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeouts.navigation });
      }, config.timeouts.base * config.timeouts.multiplier);
      log('✅ Página de login cargada');
      return;
    } catch (error) {
      log(`❌ Intento ${attempt} fallido: ${error.message}`);
      if (attempt === retries) {
        const buffer = await page.screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: buffer, caption: 'Error al cargar página inicial' });
        throw error;
      }
      await page.waitForTimeout(2000);
    }
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
    browser = await puppeteer.launch({
      headless: 'new',
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1366, height: 900 },
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    page.on('console', msg => log(`[CONSOLE] ${msg.text()}`));
    page.on('pageerror', error => log(`[ERROR] ${error.message}`));
    page.on('response', response => log(`[RESPONSE] ${response.status()} ${response.url()}`));

    await navigateToLogin(page, config.loginUrl);
    await page.type(config.selectors.login.username, process.env.WOM_USER);
    await page.type(config.selectors.login.password, process.env.WOM_PASS);
    await esperaInteligente(page, async () => {
      await page.click(config.selectors.login.loginButton);
    }, config.timeouts.base * config.timeouts.multiplier);
    log('✅ Credenciales ingresadas');

    await encontrarElemento(page, [config.selectors.factibilidad.button], config.timeouts.base * config.timeouts.multiplier);
    await esperaInteligente(page, async () => {
      await page.click(config.selectors.factibilidad.button);
    }, config.timeouts.base * config.timeouts.multiplier);
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    const inputDireccion = await encontrarElemento(page, [config.selectors.factibilidad.input], config.timeouts.base * config.timeouts.multiplier);
    await inputDireccion.click({ clickCount: 3 });
    await inputDireccion.press('Backspace');
    await page.waitForFunction(() => !document.querySelector('input[aria-busy="true"]'), { timeout: config.timeouts.base });

    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['']HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForFunction(() => document.querySelector('ul.opciones li'), { timeout: config.timeouts.base });

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
        }, config.timeouts.base * config.timeouts.multiplier);
        seleccionada = true;
        break;
      }
    }

    if (!seleccionada) {
      throw new Error('No se pudo seleccionar la dirección');
    }

    const lupa = await encontrarElemento(page, config.selectors.factibilidad.search, config.timeouts.base * config.timeouts.multiplier);
    await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
    await esperaInteligente(page, async () => {
      await lupa.click();
    }, config.timeouts.base * config.timeouts.multiplier);

    if (torre || depto) {
      await seleccionarTorreDepto(page, ctx, torre, depto);
    }

    await manejarModalResultados(page, ctx);
  } catch (error) {
    console.error('Error en bot2:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };