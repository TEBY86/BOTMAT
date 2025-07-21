const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

async function bot2(ctx, input) {
  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  async function tomarCapturaBuffer(page) {
    await page.waitForTimeout(1000);
    return await page.screenshot({ fullPage: true });
  }

  let browser;
  let opcionSeleccionada = false;

  try {
    browser = await puppeteer.launch({
      headless: true,
      slowMo: 20,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1366, height: 900 },
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (...) Chrome/123.0.0.0 Safari/537.36');
    await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2/', { waitUntil: 'networkidle2' });

    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await Promise.all([
      page.click('#kc-login'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
    await page.click('#Button_Opcion_Top_Fact_Tec');
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    // Búsqueda automática
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

      if (!inputDireccion) {
        throw new Error('❌ No se encontró un input visible para escribir la dirección.');
      }

      await inputDireccion.click();
      await page.waitForTimeout(500);

      const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
        ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
        : calle;

      await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
      await page.waitForTimeout(500);
      await inputDireccion.press('Backspace');
      await page.waitForTimeout(1500);

      const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${calle.toLowerCase()}')]`);
      await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

      const direccionEsperada = `${calle} ${numero}`.toUpperCase();

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

        console.log(`🔍 Detalles de la opción ${index + 1}:`, detalles);

        const textoUpper = texto.toUpperCase();
        const calleUpper = calle.toUpperCase();
        const numeroUpper = numero.toUpperCase();

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
          await page.waitForTimeout(500);

          const box = await opcion.boundingBox();

          if (box) {
            await ctx.reply(`🟢 Dirección exacta encontrada: ${texto}`);
            console.log(`✅ Seleccionando dirección exacta: ${texto}`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(1000);

            const lupa = await page.$('label.input_icon--left.icono-lupa');
            if (lupa) {
              await lupa.click();
              await page.waitForTimeout(2000);
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

        const numeroConCero = `0${numero}`;
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
              await ctx.reply(`🟢 Dirección con cero encontrada: ${texto}`);
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              await page.waitForTimeout(1000);
              opcionSeleccionada = true;
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

    // Ingreso manual
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('a')).some(el =>
        el.textContent.trim().toLowerCase().includes('ingresar dirección manual')
      );
    }, { timeout: 15000 });

    const links = await page.$$('a');
    for (const link of links) {
      const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), link);
      if (text.includes('ingresar dirección manual')) {
        await page.evaluate(el => el.click(), link);
        break;
      }
    }

    await ctx.reply('✍️ Ingresando datos de dirección...');

    // Región
    let regionOriginal = region.trim().toUpperCase();
    let regionFormateada = regionOriginal.includes("LIBERTADOR BERNARDO")
      ? "LIB GRAL BERNARDO"
      : region;

    await page.waitForSelector('#region', { visible: true });
    await page.click('#region', { clickCount: 3 });
    await page.type('#region', regionFormateada, { delay: 100 });
    await page.waitForTimeout(1000);

    await page.waitForSelector('.item-content', { visible: true, timeout: 5000 });
    const opciones = await page.$$('.item-content');

    for (const opcion of opciones) {
      const texto = await page.evaluate(el => el.textContent.trim().toUpperCase(), opcion);

      if (regionOriginal.includes("LIBERTADOR BERNARDO") && texto.includes("LIB GRAL BERNARDO O HIGGINS")) {
        const box = await opcion.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        break;
      }

      if (texto.includes(regionFormateada.toUpperCase())) {
        const box = await opcion.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        break;
      }
    }

    // Comuna
    await page.waitForTimeout(800);
    await page.click('#comuna', { clickCount: 3 });
    await page.type('#comuna', comuna, { delay: 100 });
    await page.waitForTimeout(1000);
    const comunaOptions = await page.$$('div');
    for (const option of comunaOptions) {
      const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), option);
      if (text === comuna.toLowerCase()) {
        await option.click();
        break;
      }
    }

    // Calle y número
    const variaciones = [
      { callePrefix: '', numeroPrefix: '' },
      { callePrefix: '', numeroPrefix: '0' },
      { callePrefix: 'Calle ', numeroPrefix: '' },
      { callePrefix: 'Calle ', numeroPrefix: '0' },
      { callePrefix: 'Avenida ', numeroPrefix: '' },
      { callePrefix: 'Avenida ', numeroPrefix: '0' },
    ];

    for (const variante of variaciones) {
      const calleCompuesta = `${variante.callePrefix}${calle}`.trim();
      const numeroCompuesto = `${variante.numeroPrefix}${numero}`.trim();

      await page.waitForTimeout(800);
      await page.click('#calle', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#calle', calleCompuesta);

      await page.waitForTimeout(500);
      await page.click('#numero', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#numero', numeroCompuesto);

      await page.waitForTimeout(1000);
      await page.waitForSelector('.input_icon--left.icono-lupa', { visible: true });
      await page.click('.input_icon--left.icono-lupa');
      await page.waitForTimeout(2500);

      const sinFact = await page.$x("//*[contains(text(), 'Dirección sin factibilidad') or contains(text(), 'dirección sin factibilidad')]");
      if (sinFact.length > 0) {
        log('⚠️ Mensaje de "Dirección sin factibilidad" detectado. Reintentando...');
        await page.waitForTimeout(500);
        await page.click('.input_icon--left.icono-lupa');
        await page.waitForTimeout(2000);
      }

      const advertencias = await page.$x("//*[contains(text(), 'Sin información') or contains(text(), 'sin información') or contains(text(), 'Dirección sin factibilidad') or contains(text(), 'dirección sin factibilidad')]");
      if (advertencias.length > 0) {
        log('⚠️ Mensaje de advertencia detectado. Reintentando...');
        await page.waitForTimeout(500);
        await page.click('.input_icon--left.icono-lupa');
        await page.waitForTimeout(2000);
      }

      await page.waitForTimeout(2000);

      const opcionesDesplegadas = await page.$$('.item-content');
      await ctx.reply(`🔍 Opciones desplegadas: ${opcionesDesplegadas.length}`);

      if (opcionesDesplegadas.length > 0) {
        const primera = opcionesDesplegadas[0];
        const texto = await page.evaluate(el => el.textContent.trim(), primera);
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
          await ctx.reply(`🟢 Primera dirección seleccionada: ${texto}`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(500);
          opcionSeleccionada = true;
          break;
        }
      }
    }

    if (!opcionSeleccionada) {
      await ctx.reply('❌ No se encontró una opción coincidente después de todas las variaciones.');
    }

    await page.waitForTimeout(1500);

    const posiblesOpciones = await page.$x(`//*[contains(text(), '${calle.toUpperCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    // Búsqueda y filtrado de opciones de departamentos
    const etiquetasTorre = ['TORRE', 'BLOCK', 'EDIFICIO'];
    for (const [index, opcion] of posiblesOpciones.entries()) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      const detalles = await page.evaluate(el => {
        return {
          texto: el.textContent,
          html: el.innerHTML,
          clase: el.className,
          tipo: el.tagName
        };
      }, opcion);
      console.log(`🔍 Detalles de la opción ${index + 1}:`, detalles);

      if (texto.length > 0 && contieneDepartamento(texto)) {
        const torreLetra = torre?.split(' ').pop();
        const torreValida = etiquetasTorre.some(etq => texto.toUpperCase().includes(etq) && texto.toUpperCase().includes(torreLetra));
        const deptoValido = texto.includes(depto);

        if (torre && !torreValida) continue;
        if (depto && !deptoValido) continue;

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
        log(`🔎 Opción ${index + 1}: ${texto} - Box: ${JSON.stringify(box)}`);

        if (box) {
          await ctx.reply(`🟢 Seleccionando: ${texto}`);
          await page.waitForTimeout(300);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(500);
          opcionSeleccionada = true;
          break;
        }
      }
    }

    if (!opcionSeleccionada) {
      await ctx.reply('❌ No se encontró una opción que coincida con Torre y Depto indicados.');
    } else {
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
    }

  } catch (error) {
    log('❌ ERROR GENERAL');
    console.error(error);
    await ctx.reply('❌ Error en el proceso. Revisa consola o inténtalo nuevamente.');
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };