const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

async function iniciarBrowser() {
  return await puppeteer.launch({
    headless: false,
    slowMo: 20,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 },
  });
}

async function loginWOM(page) {
  await page.setUserAgent('Mozilla/5.0 (...) Chrome/123.0.0.0 Safari/537.36');
  await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?...', { waitUntil: 'networkidle2' });
  await page.type('#username', process.env.WOM_USER);
  await page.type('#password', process.env.WOM_PASS);
  await Promise.all([
    page.click('#kc-login'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);
  await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
  await page.click('#Button_Opcion_Top_Fact_Tec');
}

async function tomarCapturaBuffer(page) {
  await page.waitForTimeout(1000);
  return await page.screenshot({ fullPage: true });
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function seleccionarDireccion(page, ctx, region, comuna, calle, numero, torre, depto) {
  try {
    await page.waitForSelector('input#direccion', { visible: true });
    const inputs = await page.$$('input#direccion');

    let inputDireccion;
    for (let i = 0; i < inputs.length; i++) {
      const visible = await inputs[i].evaluate(el => {
        const style = window.getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.offsetHeight > 0
        );
      });
      if (visible) {
        inputDireccion = inputs[i];
        break;
      }
    }

    if (!inputDireccion) throw new Error('❌ No se encontró un input visible para escribir la dirección.');

    await inputDireccion.click();
    await page.waitForTimeout(500);

    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    await inputDireccion.type(`${calleFormateada}`, { delay: 100 });
    await page.waitForTimeout(500);
    await inputDireccion.type(` ${numero}`, { delay: 100 });
    await page.waitForTimeout(2000);
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(1500);

    await page.waitForFunction(() => {
      const lista = document.querySelectorAll('.item-content');
      return lista.length > 0;
    }, { timeout: 5000 });

    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let opcionSeleccionada = false;
    const direccionEsperada = `${calle} ${numero}`.toUpperCase();

    for (const [index, opcion] of posiblesOpciones.entries()) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      const textoUpper = texto.toUpperCase();
      const calleUpper = calle.toUpperCase();
      const numeroUpper = numero.toUpperCase();

      if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {
        await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const box = await opcion.boundingBox();
        if (box) {
          await ctx.reply(`🟢 Dirección exacta encontrada: ${texto}`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);

          const lupa = await page.$('label.input_icon--left.icono-lupa');
          if (lupa) {
            await lupa.click();
            await page.waitForTimeout(2000);
          }

          const opcionesFinales = await page.$$('.item-content');
          if (opcionesFinales.length > 0) {
            const etiquetasTorre = ['TORRE', 'BLOCK', 'EDIFICIO'];
            for (const [index, opcion] of opcionesFinales.entries()) {
              const texto = await page.evaluate(el => el.textContent.trim(), opcion);
              if (texto.length > 0 && contieneDepartamento(texto)) {
                const torreLetra = torre?.split(' ').pop();
                const torreValida = etiquetasTorre.some(etq => texto.toUpperCase().includes(etq) && texto.toUpperCase().includes(torreLetra));
                const deptoValido = texto.includes(depto);

                if (torre && !torreValida) continue;
                if (depto && !deptoValido) continue;

                await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
                const box = await opcion.boundingBox();
                if (box) {
                  await ctx.reply(`🟢 Seleccionando: ${texto}`);
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                  await page.waitForTimeout(500);
                  opcionSeleccionada = true;
                  break;
                }
              }
            }

            if (!opcionSeleccionada) {
              const primeraOpcion = opcionesFinales[0];
              const boxPrimera = await primeraOpcion.boundingBox();
              if (boxPrimera) {
                await page.mouse.move(boxPrimera.x + boxPrimera.width / 2, boxPrimera.y + boxPrimera.height / 2);
                await page.mouse.click(boxPrimera.x + boxPrimera.width / 2, boxPrimera.y + boxPrimera.height / 2);
                await page.waitForTimeout(1000);
              }
            }
          }

          await ctx.reply('✅ Dirección completada factibilizada...');

          try {
            await page.waitForSelector('section.modal_cnt.container-row', { visible: true, timeout: 10000 });
            await page.evaluate(() => {
              const modal = document.querySelector('section.modal_cnt.container-row');
              if (modal) modal.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
            await page.waitForTimeout(1000);
            const modal = await page.$('section.modal_cnt.container-row');
            const buffer = await modal.screenshot();
            await ctx.replyWithPhoto({ source: buffer });
            await ctx.reply('📸 Captura del resultado tomada correctamente.');
          } catch (e) {
            log('⚠️ Modal no detectado, se tomará pantalla completa');
            const buffer = await tomarCapturaBuffer(page);
            await ctx.replyWithPhoto({ source: buffer });
          }

          opcionSeleccionada = true;
          break;
        }
      }
    }

    if (!opcionSeleccionada) {
      await ctx.reply('🔄 No se encontró coincidencia exacta. Reintentando con 0 al inicio del número...');

      await inputDireccion.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      const numeroConCero = '0' + numero;
      await inputDireccion.type(`${calle} ${numeroConCero}`, { delay: 100 });
      await page.waitForTimeout(500);
      await inputDireccion.press('Backspace');
      await page.waitForTimeout(1500);

      const nuevasOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${calle.toLowerCase()}')]`);
      await ctx.reply(`🔍 Reintento - Opciones encontradas: ${nuevasOpciones.length}`);

      for (const [index, opcion] of nuevasOpciones.entries()) {
        const texto = await page.evaluate(el => el.textContent.trim(), opcion);
        const textoUpper = texto.toUpperCase();
        const numeroUpper = numeroConCero.toUpperCase();
        const calleUpper = calle.toUpperCase();

        if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {
          await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
          const box = await opcion.boundingBox();
          if (box) {
            await ctx.reply(`🟢 Dirección con cero encontrada: ${texto}`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(1000);
            break;
          }
        }
      }

      if (!opcionSeleccionada) {
        await ctx.reply('❌ Tampoco se encontró con número modificado. Continuando en modo manual...');
        console.log(`⚠️ Ninguna opción coincide con número 0-prefijado: ${calle} 0${numero}`);
      }
    }
  } catch (e) {
    console.error('❌ Error en la búsqueda automática:', e);
    await ctx.reply('⚠️ Hubo un problema en la búsqueda automática. Continuando en modo manual...');
  }
}

async function bot2(ctx, input) {
  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  let browser;

  try {
    browser = await iniciarBrowser();
    const page = await browser.newPage();
    await loginWOM(page);
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    await seleccionarDireccion(page, ctx, region, comuna, calle, numero, torre, depto);

  } catch (e) {
    console.error('❌ Error en la búsqueda automática:', e);
    await ctx.reply('⚠️ Hubo un problema en la búsqueda automática. Continuando en modo manual...');
  }
}

module.exports = bot2;
