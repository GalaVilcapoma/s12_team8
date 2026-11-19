# ==============================================================================
# Dockerfile: Aplicación AVSA Node.js en K3s
# Imagen base: Node 20 Alpine (mínima superficie de ataque)
# Hardening: Ejecución con usuario sin privilegios 'appuser' (UID 10001, GID 10001)
# ==============================================================================
FROM node:20-alpine

# Definición de variables de entorno estándar
ENV NODE_ENV=production \
    APP_PORT=3000

# 1. Crear grupo y usuario sin privilegios explícitos (UID 10001, GID 10001)
RUN addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup

# 2. Configurar directorio de trabajo
WORKDIR /app

# 3. Copiar únicamente dependencias primero para optimizar el caché de capas
COPY package.json ./

# 4. Instalar dependencias estrictamente para producción y limpiar caché
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# 5. Copiar código fuente de la aplicación
COPY server.js ./

# 6. Configurar permisos seguros sobre archivos y directorios temporales
RUN chown -R appuser:appgroup /app && \
    chmod -R 550 /app && \
    mkdir -p /home/appuser /tmp && \
    chown -R appuser:appgroup /home/appuser /tmp && \
    chmod 770 /home/appuser /tmp

# 7. Cambiar al usuario no privilegiado (UID:GID)
USER 10001:10001

# 8. Documentar puerto expuesto
EXPOSE 3000

# 9. Comando de ejecución
CMD ["node", "server.js"]
