# Pruebas de impresión sin hardware

Este recorrido prueba el mismo payload ESC/POS y el mismo transporte TCP que
usará la impresora. La única sustitución es el destino: un servidor local guarda
los bytes en vez de calentarlos en el cabezal tÃ©rmico.

## Prueba automatizada

```powershell
pnpm test:printer
```

La prueba levanta API e impresora virtual en puertos efímeros, crea un ticket,
lo renderiza, lo reclama, lo transmite por TCP, captura el spool y comprueba:

- inicialización ESC/POS;
- raster monocromo de 576 px;
- longitud completa de la imagen;
- avance de tres lÃ­neas y orden de corte;
- igualdad byte a byte entre artefacto, spool y datos recibidos;
- estado final `printed_simulated` sin duplicar el comando.

## Prueba manual visible

Arranca la API y crea un ticket desde la PWA. Después, en otra terminal:

```powershell
pnpm virtual-printer
```

La impresora virtual escucha en `127.0.0.1:9100`. Con el `jobId` devuelto por
la API, ejecuta:

```powershell
pnpm --filter @printdesk/windows-print-agent print:tcp -- `
  http://localhost:8080 JOB_ID 127.0.0.1 9100 .local-data/spool --simulated
```

Los bytes capturados quedan en `.local-data/virtual-printer/`. La opción
`--simulated` conserva el estado `printed_simulated`; con hardware real se omite
y el agente completa el trabajo como `printed`.

## Cambio a la impresora real

1. Conecta la impresora por Ethernet o Wi-Fi y asígnale una IP reservada en el
   router; evita que DHCP cambie la dirección.
2. Activa RAW TCP/JetDirect y confirma el puerto, normalmente `9100`.
3. Desde el PC del agente comprueba conectividad:

   ```powershell
   Test-NetConnection IP_DE_LA_IMPRESORA -Port 9100
   ```

4. Sustituye `127.0.0.1 9100` por `IP_DE_LA_IMPRESORA 9100` en `print:tcp`.
5. Imprime primero un ticket corto y revisa ancho, densidad, QR, avance y corte.

No hace falta instalar un driver de Windows: PrintDesk envía ESC/POS RAW
directamente por TCP. Esto presupone que el modelo admite ESC/POS, raster
`GS v 0` y corte `GS V 0`; al llegar la impresora se confirmarÃ¡ con su manual.

## Seguridad ante duplicados

El agente reintenta conexiones fallidas antes de enviar datos. Si la conexión
falla después de comenzar el envío, no reenvía automáticamente: no se puede saber
si el papel llegó a imprimirse y repetirlo podría generar un duplicado. Ese caso
queda en estado `failed` para revisión.
