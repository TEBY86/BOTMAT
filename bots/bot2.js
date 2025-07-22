const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto, torre, depto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  texto = texto.toUpperCase();
  const hasClave = claves.some(clave => texto.includes(clave));
  if (torre && depto) {
    return hasClave && texto.includes(torre.toUpperCase()) && texto.includes(depto.toUpperCase());
  } else if (torre) {
    return hasClave && texto.includes(torre.toUpperCase());
  } else if (depto) {
    return hasClave && texto.includes(depto.toUpperCase());
  }
  return hasClave;
}

async function bot2(ctx, input) {
  // Validar credenciales
  if (!process.env.WOM_USER || !process.env.WOM_PASS) {
    await ctx.reply('❌ Error: Credenciales WOM_USER o WOM_PASS no configuradas en .env');
    return;
  }

  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x?.trim() || '');
  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  await ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  async function tomarCapturaBuffer(page) {
    try {
      await page.waitForTimeout(1000);
      return await page.screenshot({ fullPage: true });
    } catch (e) {
      log(`⚠️ Error al tomar captura: ${e.message}`);
      return null;
    }
  }

  let browser;
  let opcionSeleccionada = false;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1366, height: 900 },
      dumpio: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2', {
      waitUntil: 'networkidle2',
      timeout: 120000,
    });

    // Login
    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await Promise.all([
      page.click('#kc-login'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }).catch(e => log(`⚠️ Error en navegación: ${e.message}`)),
    ]);

    // Seleccionar Factibilidad Técnica
    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true, timeout: 120000 });
    await page.click('#Button_Opcion_Top_Fact_Tec');
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    // Búsqueda automática
    async function buscarDireccion(direccion) {
      try {
        await page.waitForSelector('input#direccion', { visible: true, timeout: 120000 });
        const inputs = await page.$$('input#direccion');
        let inputDireccion;
        for (const input of inputs) {
          const visible = await input.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
          });
          if (visible) {
            inputDireccion = input;
            break;
          }
        }

        if (!inputDireccion) {
          const buffer = await tomarCapturaBuffer(page);
          if (buffer) await ctx.replyWithPhoto({ source: buffer });
          throw new Error('❌ No se encontró un input visible para escribir la dirección.');
        }

        await inputDireccion.click({ clickCount: 3 });
        await inputDireccion.type(direccion, { delay: 100 });
        await page.waitForTimeout(500);
        await inputDireccion.press('Backspace');
        await page.waitForTimeout(1500);

        const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${calle.toLowerCase()}')]`);
        await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

        if (posiblesOpciones.length === 0) {
          const buffer = await tomarCapturaBuffer(page);
          if (buffer) await ctx.replyWithPhoto({ source: buffer });
          await ctx.reply(`❌ No se encontraron opciones para "${direccion}". Captura enviada.`);
          return false;
        }

        for (const [index, opcion] of posiblesOpciones.entries()) {
          const texto = await page.evaluate(el => el.textContent.trim(), opcion);
          const textoUpper = texto.toUpperCase();
          const calleUpper = calle.toUpperCase();
          const numeroUpper = direccion.split(' ').pop().toUpperCase();

          if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {
            await page.evaluate((text) => {
              const items = Array.from(document.querySelectorAll('.item-content'));
              const contenedor = document.querySelector('section.drop_down');
              const target = items.find(el => el.textContent.trim() === text);
              if (target && contenedor) {
                contenedor.scrollTop = target.offsetTop - 100;
              }
            }, texto);

            await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
            const box = await opcion.boundingBox();
            if (box) {
              await ctx.reply(`🟢 Dirección encontrada: ${texto}`);
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              await page.waitForTimeout(1000);

              const lupa = await page.$('.input_icon--left.icono-lupa');
              if (lupa) {
                await lupa.click();
                await page.waitForTimeout(2000);
              }

              await ctx.reply('✅ Dirección completada factibilizada...');
              return true;
            }
          }
        }
        return false;
      } catch (e) {
        log(`⚠️ Error en búsqueda automática: ${e.message}`);
        const buffer = await tomarCapturaBuffer(page);
        if (buffer) await ctx.replyWithPhoto({ source: buffer });
        await ctx.reply('⚠️ Error en búsqueda automática. Captura enviada.');
        return false;
      }
    }

    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    // Intentar búsqueda con número normal y con cero
    const direcciones = [
      `${calleFormateada} ${numero}`,
      `${calleFormateada} 0${numero}`,
    ];

    for (const direccion of direcciones) {
      if (await buscarDireccion(direccion)) {
        opcionSeleccionada = true;
        break;
      }
    }

    // Ingreso manual si la búsqueda automática falla
    if (!opcionSeleccionada) {
      await ctx.reply('🔄 Búsqueda automática fallida. Probando ingreso manual...');

      const manualLink = await page.$x("//a[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'ingresar dirección manual')]");
      if (manualLink.length > 0) {
        await manualLink[0].click();
        await ctx.reply('✍️ Ingresando datos de dirección manualmente...');

        // Región
        let regionFormateada = region.trim().toUpperCase().includes("LIBERTADOR BERNARDO")
          ? "LIB GRAL BERNARDO O HIGGINS"
          : region;

        await page.waitForSelector('#region', { visible: true, timeout: 120000 });
        await page.click('#region', { clickCount: 3 });
        await page.type('#region', regionFormateada, { delay: 100 });
        await page.waitForTimeout(1000);

        const regionOptions = await page.$$('.item-content');
        for (const option of regionOptions) {
          const texto = await page.evaluate(el => el.textContent.trim().toUpperCase(), option);
          if (texto.includes(regionFormateada.toUpperCase())) {
            const box = await option.boundingBox();
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              break;
            }
          }
        }

        // Comuna
        await page.waitForSelector('#comuna', { visible: true, timeout: 120000 });
        await page.click('#comuna', { clickCount: 3 });
        await page.type('#comuna', comuna, { delay: 100 });
        await page.waitForTimeout(1000);
        const comunaOptions = await page.$$('.item-content');
        for (const option of comunaOptions) {
          const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), option);
          if (text === comuna.toLowerCase()) {
            await option.click();
            break;
          }
        }

        // Calle y Número
        const variaciones = [
          { calle: calleFormateada, numero },
          { calle: calleFormateada, numero: `0${numero}` },
          { calle: `Calle ${calleFormateada}`, numero },
          { calle: `Calle ${calleFormateada}`, numero: `0${numero}` },
          { calle: `Avenida ${calleFormateada}`, numero },
          { calle: `Avenida ${calleFormateada}`, numero: `0${numero}` },
        ];

        let reintentos = 0;
        const maxReintentos = 3;

        for (const { calle, numero } of variaciones) {
          await page.waitForSelector('#calle', { visible: true, timeout: 120000 });
          await page.click('#calle', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.type('#calle', calle);

          await page.waitForSelector('#numero', { visible: true, timeout: 120000 });
          await page.click('#numero', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.type('#numero', numero);

          // Torre y Depto si existen
          if (torre) {
            await page.waitForSelector('#torre', { visible: true, timeout: 5000 }).catch(() => null);
            const torreInput = await page.$('#torre');
            if (torreInput) {
              await torreInput.click({ clickCount: 3 });
              await page.keyboard.press('Backspace');
              await page.type('#torre', torre);
            }
          }
          if (depto) {
            await page.waitForSelector('#depto', { visible: true, timeout: 5000 }).catch(() => null);
            const deptoInput = await page.$('#depto');
            if (deptoInput) {
              await deptoInput.click({ clickCount: 3 });
              await page.keyboard.press('Backspace');
              await page.type('#depto', depto);
            }
          }

          await page.waitForSelector('.input_icon--left.icono-lupa', { visible: true, timeout: 120000 });
          await page.click('.input_icon--left.icono-lupa');
          await page.waitForTimeout(2500);

          const sinFact = await page.$x("//*[contains(text(), 'Dirección sin factibilidad') or contains(text(), 'dirección sin factibilidad')]");
          if (sinFact.length > 0) {
            const mensaje = await page.evaluate(el => el.textContent.trim(), sinFact[0]);
            log(`⚠️ Mensaje de "Dirección sin factibilidad" detectado: ${mensaje}`);
            await ctx.reply(`⚠️ La página devolvió: "${mensaje}". Reintentando (${reintentos + 1}/${maxReintentos})...`);
            reintentos++;
            if (reintentos >= maxReintentos) {
              const buffer = await tomarCapturaBuffer(page);
              if (buffer) await ctx.replyWithPhoto({ source: buffer });
              await ctx.reply('❌ Máximo de reintentos alcanzado. La dirección no tiene factibilidad.');
              return;
            }
            continue;
          }

          const opcionesDesplegadas = await page.$$('.item-content');
          if (opcionesDesplegadas.length > 0) {
            const primera = opcionesDesplegadas[0];
            const texto = await page.evaluate(el => el.textContent.trim(), primera);
            if (contieneDepartamento(texto, torre, depto)) {
              await page.evaluate((text) => {
                const items = Array.from(document.querySelectorAll('.item-content'));
                const contenedor = document.querySelector('section.drop_down');
                const target = items.find(el => el.textContent.trim() === text);
                if (target && contenedor) {
                  contenedor.scrollTop = target.offsetTop - 100;
                }
              }, texto);
              await primera.evaluate(el => el.scrollIntoView({ block: 'center' }));
              const box = await primera.boundingBox();
              if (box) {
                await ctx.reply(`🟢 Dirección seleccionada: ${texto}`);
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                opcionSeleccionada = true;
                break;
              }
            }
          }
        }

        if (!opcionSeleccionada) {
          const buffer = await tomarCapturaBuffer(page);
          if (buffer) await ctx.replyWithPhoto({ source: buffer });
          await ctx.reply('❌ No se encontró una opción coincidente después de todas las variaciones.');
          return;
        }
      } else {
        const buffer = await tomarCapturaBuffer(page);
        if (buffer) await ctx.replyWithPhoto({ source: buffer });
        await ctx.reply('❌ No se encontró el enlace para ingreso manual.');
        return;
      }
    }

    // Captura final del resultado
    if (opcionSeleccionada) {
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
        log(`⚠️ Modal no detectado: ${e.message}`);
        const buffer = await tomarCapturaBuffer(page);
        if (buffer) await ctx.replyWithPhoto({ source: buffer });
        await ctx.reply('📸 Captura de pantalla completa enviada.');
      }
    }

  } catch (error) {
    log(`❌ Error general: ${error.message}`);
    const buffer = await tomarCapturaBuffer(page).catch(() => null);
    if (buffer) await ctx.replyWithPhoto({ source: buffer });
    await ctx.reply('❌ Error en el proceso. Captura enviada si está disponible.');
  } finally {
    if (browser) await browser.close().catch(e => log(`⚠️ Error al cerrar navegador: ${e.message}`));
  }
}

module.exports = { bot2 };