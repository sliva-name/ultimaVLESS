import type { ErrorPhrases } from './patterns';

export const es: ErrorPhrases = {
  // Xray process
  configGenerationFailed: 'Error en la configuración del servidor: ',
  xrayBinaryNotFound: 'No se encontró el ejecutable de Xray: ',
  portInUse:
    'El puerto $<port> en 127.0.0.1 lo usa otro programa (¿otro cliente VPN o proxy?). Ciérralo y vuelve a conectar.',
  portUnavailable:
    'El puerto $<port> en 127.0.0.1 no está disponible ($<code>).',
  xrayExitedAtStartup:
    'Xray se cerró al iniciarse (código $<code>, señal $<signal>)',
  xrayExitedUnexpectedly:
    'Xray se cerró inesperadamente (código $<code>, señal $<signal>)',
  xrayExitedBeforeListeners:
    'Xray se cerró antes de abrir los puertos locales del proxy',
  listenersUnreachable: 'Los puertos locales del proxy no responden',
  xrayHealthFailed: 'Xray informó de un fallo',

  // Connection and health checks
  connectionError: 'Error de conexión: ',
  connectionFailed: 'No se pudo conectar',
  disconnected: 'Desconectado',
  connectedTo: 'Conectado a $<name>',
  switchingFromTo: 'Cambiando de $<from> a $<to>',
  switchingTo: 'Cambiando a $<name>',
  remoteCheckFailed:
    'La comprobación de acceso a internet a través del túnel falló tras varios intentos (el túnel es lento o está bloqueado)',
  hostOffline:
    'No hay acceso a internet ni sin VPN; el cambio automático se aplaza',
  postSwitchCheckFailed: 'Tras cambiar de servidor, el tráfico no pasa',
  serverNotFound: 'El servidor elegido no está en la lista',
  autoSwitchOffline: 'Cambio automático interrumpido: no hay acceso a internet',
  autoSwitchTimeUp: 'Cambio automático detenido: se agotó el tiempo',
  autoSwitchNoServers:
    'El cambio automático falló: no se encontraron servidores que funcionen',
  autoSwitchFailed: 'El cambio automático falló',

  // TUN and system proxy
  tunUnsupported: 'El modo TUN no es compatible con este sistema operativo.',
  tunNeedsAdmin:
    'El modo TUN necesita permisos de administrador. Acepta el aviso de UAC o ejecuta UltimaVLESS como administrador.',
  tunNeedsPolkit:
    'El modo TUN necesita permisos elevados. Instala un agente de PolicyKit (pkexec) para que UltimaVLESS los pida al conectar, o ejecuta UltimaVLESS como root.',
  tunNeedsRoot:
    'En este sistema operativo el modo TUN necesita permisos de root. Ejecuta la aplicación con permisos elevados.',
  tunAuthDeclined:
    'El modo TUN necesita permisos elevados, pero la solicitud se rechazó o se cerró.',

  // Android VpnService
  vpnPermissionDenied:
    'Sin permiso de VPN: acepta la solicitud de Android al conectar',
  vpnRevoked: 'VPN desactivada: otro cliente VPN ocupó el túnel',
  vpnServiceStopped: 'El sistema detuvo el servicio VPN',
  localProxyNotOpened: 'Xray no abrió el proxy local en 127.0.0.1:$<port>',
  tunRootPrepareFailed:
    'El modo TUN no pudo preparar Xray para ejecutarse como root: ',
  tunRootCopyFailed:
    'El modo TUN no pudo crear una copia de Xray propiedad de root',
  tunRootCopyMismatch:
    'El modo TUN no ejecutó Xray: la copia no coincide con la incluida en UltimaVLESS',
  tunRootRunFailed: 'El modo TUN no pudo ejecutar Xray como root',
  tunAdapterNoGateway:
    'El adaptador «$<name>» elegido para TUN no tiene puerta de enlace IPv4 predeterminada (está desconectado o no da acceso a internet). Elige otro adaptador en «Ajustes → Red» o «Automático».',
  noDefaultRoute:
    'No se encontró la ruta predeterminada. Comprueba la conexión de red.',
  proxyResolveFailed: 'No se pudo obtener la IP del servidor: ',
  modeChangeWhileConnecting:
    'Espera a que termine la conexión antes de cambiar el modo de red.',
  linuxProxyNeedsGnome:
    'Para el proxy del sistema en Linux se necesita un escritorio compatible con GNOME y la herramienta gsettings.',
  linuxProxyEnableFailed:
    'No se pudo activar el proxy del sistema con gsettings: ',
  linuxProxyDisableFailed:
    'No se pudo desactivar el proxy del sistema con gsettings: ',
  macNoNetworkServices:
    'No se encontraron servicios de red de macOS para configurar el proxy del sistema.',

  // Server profile vs bundled Xray
  trojanNeedsTls:
    'Xray $<version> no se conecta a una dirección pública por Trojan sin TLS o REALITY. Indica security=tls o security=reality.',
  vlessNeedsTls:
    'Xray $<version> no se conecta a una dirección pública por VLESS sin TLS, REALITY o VLESS Encryption. Indica security=tls o security=reality.',
  hysteriaNeedsTls:
    'En Xray $<version>, Hysteria solo funciona con TLS (streamSettings.security=tls).',
  allowInsecureRemoved:
    'En Xray $<version> se eliminó el parámetro «allowInsecure»; usa pinnedPeerCertSha256 (pcs) y/o verifyPeerCertByName (vcn) en su lugar.',
  ssMethodRemoved:
    'El método de Shadowsocks «$<method>» se eliminó en Xray $<version>; usa un cifrado AEAD (por ejemplo, aes-128-gcm o chacha20-poly1305).',
  ssMethodRequired: 'Falta el método de cifrado de Shadowsocks.',
  httpTransportUnsupported:
    'Xray $<version> no admite el transporte HTTP; usa XHTTP.',
  quicTransportUnsupported:
    'Xray $<version> no admite el transporte QUIC; usa XHTTP/H3.',
  realityTransport:
    'REALITY solo funciona con los transportes RAW/TCP, XHTTP y gRPC.',
  hysteriaNeedsAuth: 'Hysteria necesita una contraseña (hysteriaAuth).',
  wgNeedsKey: 'WireGuard necesita una clave privada (wgSecretKey).',
  wgNeedsAddress: 'WireGuard necesita una dirección de interfaz (wgAddress).',
  wgNeedsPeer: 'WireGuard necesita al menos un par (peer).',
  rawConfigNeedsProxy:
    'La configuración JSON necesita un outbound «proxy» con un protocolo de túnel.',

  // Subscriptions
  subscriptionNoLinks:
    'La suscripción no tiene ningún enlace de servidor válido',
  noValidLinks: 'No se encontró ningún enlace de servidor válido',
  manualNoValidLinks: 'Ninguno de los enlaces añadidos a mano es válido',
  subscriptionHttpError:
    'El servidor de la suscripción respondió con un error HTTP $<status>',
  subscriptionTimeout:
    'El servidor de la suscripción no respondió en $<seconds> s',
  subscriptionUnreachable:
    'No se pudo contactar con el servidor de la suscripción ($<code>)',
  subscriptionTooLarge: 'La respuesta de la suscripción es demasiado grande',
  subscriptionEmpty: 'La suscripción devolvió una respuesta vacía',
  subscriptionBadBase64:
    'La suscripción devolvió datos dañados (error de Base64)',
  subscriptionHtmlPage:
    'La dirección de la suscripción abrió una página HTML sin enlaces de servidores',
  subscriptionPrivateIp: 'La dirección de la suscripción apunta a una IP local',
  subscriptionHostNotAllowed: 'Esta dirección de suscripción no está permitida',
  subscriptionNoAddress: 'No se encontró la IP del servidor de la suscripción',
  subscriptionDnsFailed:
    'No se pudo verificar la dirección del servidor de la suscripción (la consulta DNS falló o tardó demasiado)',
  subscriptionTooManyRedirects:
    'Demasiadas redirecciones al cargar la suscripción (máximo $<max>)',
  subscriptionRedirectNoLocation:
    'El servidor de la suscripción devolvió una redirección sin dirección (HTTP $<status>)',
  subscriptionHttpsOnly: 'Solo se permiten direcciones de suscripción HTTPS',
  happEncryptedLink:
    'Es un enlace cifrado de Happ (happ://crypt…): solo la aplicación Happ puede abrirlo. Pide a tu proveedor un enlace de suscripción normal que empiece por https://',
  subscriptionInvalidUrl: 'La dirección de la suscripción no es válida',
  subscriptionNameRequired: 'Indica el nombre de la suscripción',
  subscriptionUrlRequired: 'Indica la dirección de la suscripción',
  subscriptionNameTooLong:
    'El nombre de la suscripción es demasiado largo (máximo $<max> caracteres)',
  subscriptionUrlTooLong:
    'La dirección de la suscripción es demasiado larga (máximo $<max> caracteres)',
  manualLinksTooLarge:
    'Hay demasiado texto en los enlaces (máximo $<max> caracteres)',
};
