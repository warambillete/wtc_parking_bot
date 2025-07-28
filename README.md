# WTC ParkBot 🚗

Bot de Telegram para gestión de estacionamientos del edificio WTC.

## Características

- **Reservas inteligentes**: Reconoce mensajes como "voy el martes" o "necesito estacionamiento mañana"
- **Liberación automática**: Detecta mensajes como "libero el miércoles" o "mañana queda libre"
- **Reglas de tiempo**: Solo permite reservas para la semana actual (lunes-viernes), y para la próxima semana solo los viernes después de las 5 PM GMT-3
- **Lista de espera**: Si no hay espacios disponibles, ofrece poner al usuario en lista de espera
- **Notificaciones automáticas**: Cuando se libera un espacio, notifica al primer usuario en lista de espera
- **Múltiples días**: Soporte para "la próxima semana voy el lunes, miércoles y viernes"
- **Reset automático**: Cada viernes a las 17:00 GMT-3 se eliminan todas las reservas automáticamente
- **Gestión de supervisor**: Comandos administrativos para gestionar el sistema

## Instalación

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar el bot:**
   - Copia `.env.example` a `.env`
   - Agrega tu token de bot de Telegram
   - Agrega tu user ID como supervisor

3. **Configurar estacionamientos:**
   ```bash
   # Como supervisor, envía este comando al bot:
   /setparking 1,2,3,4,5,6,7,8,9,10
   ```

## Uso

### Comandos de usuarios:

**Reservar:**
- "voy el martes"
- "necesito estacionamiento mañana"
- "la próxima semana voy el lunes y viernes"

**Liberar:**
- "libero el miércoles"
- "mañana queda libre"
- "no voy el viernes"

**Estado:**
- "estado"
- "disponibles"
- "qué días hay?"

### Comandos de supervisor:

- `/setparking 1,2,3,4,5` - Actualizar lista de estacionamientos (elimina todas las reservas)
- `/clearall` - Eliminar todas las reservas y listas de espera manualmente
- `/status` - Ver estadísticas del sistema (total de espacios, reservas, lista de espera)

## Ejecutar

```bash
# Desarrollo
npm run dev

# Producción
npm start
```

## Estructura del proyecto

```
src/
├── bot.js              # Bot principal
├── messageProcessor.js # Procesamiento de lenguaje natural
├── parkingManager.js   # Lógica de gestión de estacionamientos
└── database.js         # Manejo de base de datos SQLite
data/
└── parking.db          # Base de datos SQLite
```

## Reglas de negocio

1. **Horarios de reserva:**
   - Semana actual (lunes-viernes): cualquier momento
   - Próxima semana: solo viernes después de 5 PM GMT-3
   - **No se permiten reservas para fines de semana**

2. **Reset automático:**
   - **Cada viernes a las 17:00 GMT-3** se eliminan todas las reservas
   - El supervisor recibe notificación automática del reset
   - Permite que todos tengan oportunidad para la siguiente semana

3. **Lista de espera:**
   - Se activa automáticamente cuando no hay espacios
   - Notificaciones en orden de llegada
   - Auto-eliminación si rechaza la oferta

4. **Múltiples reservas:**
   - Un usuario puede tener máximo una reserva por día
   - Soporte para múltiples días en un mensaje

5. **Gestión de espacios:**
   - Actualizar la lista de estacionamientos elimina todas las reservas existentes
   - Los espacios se asignan automáticamente por orden numérico