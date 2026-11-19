# Bitácora Técnica de Troubleshooting - Proyecto AVSA (Kubernetes en AWS EC2)

- **Proyecto:** AVSA - Despliegue Cloud, Seguridad y Troubleshooting en Kubernetes (K3s) sobre AWS EC2
- **Namespace:** `practica-s12`
- **Nivel de Seguridad:** Pod Security Admission (PSA) `restricted`
- **Fecha de Elaboración:** 2026-11-18
- **Estado Inicial del Escenario:** Fallas inyectadas activas (A, B y C)

---

## 1. Resumen Ejecutivo de Fallas Inyectadas

| ID | Dimensión | Componente Afectado | Síntoma Principal | Causa Raíz | Impacto en el Negocio |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Falla A** | Configuración | `app-config` (ConfigMap) | Pods en estado `CrashLoopBackOff` | Discrepancia de clave: `DATABASE_NAME` vs `DB_NAME` | Aplicación inoperativa (caída total de pods). |
| **Falla B** | Red Interna | `mongo-service` (Service) | Endpoint `/health/ready` responde `503`, BD `"DESCONECTADO"` | `targetPort` incorrecto (`27018` en vez de `27017`) | Imposibilidad de persistencia y fallo en operaciones CRUD. |
| **Falla C** | Sondas de Salud | `app` (Deployment) | Pods reiniciándose en bucle (`Unhealthy`, `0/1 Running`) | Rutas de sondas apuntando a `/healthz` y `/ready` (404) | Inestabilidad del servicio y falso descarte de réplicas en kubelet. |

---

## 2. Investigación y Resolución Detallada por Falla

```
                            FLUJO DE TROUBLESHOOTING
    +-----------------------------------------------------------------------+
    | 1. Detectar Pods en CrashLoopBackOff  --> Resolver Falla A (ConfigMap) |
    +-----------------------------------------------------------------------+
                                        |
                                        v
    +-----------------------------------------------------------------------+
    | 2. Detectar Pods reiniciándose (404)  --> Resolver Falla C (Sondas)   |
    +-----------------------------------------------------------------------+
                                        |
                                        v
    +-----------------------------------------------------------------------+
    | 3. Detectar MongoDB desconectado (503) --> Resolver Falla B (Service) |
    +-----------------------------------------------------------------------+
                                        |
                                        v
    +-----------------------------------------------------------------------+
    | 4. Estado Óptimo: 2/2 Pods Ready, MongoDB CONECTADO, CRUD Operativo   |
    +-----------------------------------------------------------------------+
```

---

### FALLA A: Error de Configuración de Entorno (CrashLoopBackOff)

#### 1. Síntoma Detectado
Al consultar el estado de los pods en el namespace `practica-s12`, las réplicas de la aplicación `app` no alcanzan el estado `Running` y entran en `CrashLoopBackOff` continuo:
```bash
kubectl get pods -n practica-s12
```
**Salida observada:**
```text
NAME                     READY   STATUS             RESTARTS      AGE
mongo-745bf94bd-x8k1l    1/1     Running            0             4m12s
app-579979b9cf-2lm8z     0/1     CrashLoopBackOff   4 (85s ago)   3m45s
app-579979b9cf-9q4np     0/1     CrashLoopBackOff   4 (82s ago)   3m45s
```

#### 2. Diagnóstico Técnico
Se inspeccionan los logs del pod afectado para determinar por qué el contenedor finaliza su ejecución:
```bash
kubectl logs -n practica-s12 -l app=app --tail=30
```
**Salida de logs:**
```text
[AVSA] Iniciando aplicación...
- DB_NAME: <NO DEFINIDO>
=========================================================
[ERROR FATAL] Variable de entorno requerida "DB_NAME" no está definida.
La aplicación no puede iniciar sin especificar la base de datos.
Verifique el ConfigMap o las variables de entorno asociadas.
=========================================================
```

Luego se inspecciona el ConfigMap montado por el Deployment:
```bash
kubectl get configmap app-config -n practica-s12 -o yaml
```
**Fragmento detectado en `data`:**
```yaml
data:
  APP_PORT: "3000"
  DATABASE_NAME: practica_s12   # <-- Clave discordante
  DB_HOST: mongo-service
  DB_PORT: "27017"
```

#### 3. Causa Raíz
El código de la aplicación Node.js (`src/server.js`) requiere obligatoriamente `process.env.DB_NAME`. En el archivo `01-security-configmap.yaml` del escenario con fallas, la clave se definió erróneamente como `DATABASE_NAME`. Al no existir la variable `DB_NAME`, el código ejecuta `process.exit(1)`, lo que genera la terminación del proceso y el ciclo `CrashLoopBackOff` por parte de Kubernetes.

#### 4. Solución Aplicada
Se aplica la versión corregida del ConfigMap ubicada en `k8s/01-security-configmap.yaml`, donde se define la clave estándar `DB_NAME`:
```bash
# Opción 1: Aplicar manifiesto corregido
kubectl apply -f /home/ubuntu/s12/k8s/01-security-configmap.yaml

# Opción 2: Corregir en caliente con kubectl patch
kubectl patch configmap app-config -n practica-s12 --type merge -p '{"data":{"DB_NAME":"practica_s12"}}'

# Reiniciar el Deployment para recargar las variables de entorno
kubectl rollout restart deployment/app -n practica-s12
```

#### 5. Verificación
```bash
kubectl get pods -n practica-s12 -l app=app
```
Los pods superan el fallo fatal y avanzan en su inicialización.

---

### FALLA C: Sondas de Salud Apuntando a Rutas Inexistentes (HTTP 404)

*(Nota: Se aborda cronológicamente antes de la Falla B porque condiciona el estado de vitalidad y preparación del contenedor de la aplicación).*

#### 1. Síntoma Detectado
Tras solucionar la Falla A, los pods logran iniciar (`Running`), pero se mantienen en estado `0/1 Ready` y se reinician periódicamente después de varios segundos:
```bash
kubectl get pods -n practica-s12 -l app=app
```
**Salida observada:**
```text
NAME                   READY   STATUS    RESTARTS      AGE
app-6c9b48679b-d72lk   0/1     Running   3 (40s ago)   2m10s
app-6c9b48679b-w55jk   0/1     Running   3 (42s ago)   2m10s
```

#### 2. Diagnóstico Técnico
Se examinan los eventos del pod mediante `kubectl describe`:
```bash
kubectl describe pod -n practica-s12 -l app=app | grep -E "Warning|Liveness|Readiness" -A 2
```
**Salida observada:**
```text
Warning  Unhealthy  15s (x4 over 35s)  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 404
Warning  Unhealthy  5s (x3 over 25s)   kubelet  Liveness probe failed: HTTP probe failed with statuscode: 404
Normal   Killing    5s                 kubelet  Container app failed liveness probe, will be restarted
```

Al revisar el código de `src/server.js`, se observa que las rutas de salud registradas son:
- `/health/live`
- `/health/ready`

Sin embargo, en el Deployment `escenarios/con-fallas/03-app-deployment.yaml`, las sondas están configuradas como:
```yaml
livenessProbe:
  httpGet:
    path: /healthz    # <-- No implementada en Express (devuelve 404)
    port: 3000
readinessProbe:
  httpGet:
    path: /ready      # <-- No implementada en Express (devuelve 404)
    port: 3000
```

#### 3. Causa Raíz
Discrepancia entre las rutas HTTP configuradas en el Deployment de Kubernetes y los endpoints declarados en el servidor Express. Kubelet realiza peticiones HTTP GET a `/healthz` y `/ready`; al recibir un código `404 Not Found`, asume que el contenedor está defectuoso y ejecuta la política de reinicio (`Container failed liveness probe, will be restarted`).

#### 4. Solución Aplicada
Se actualizan las especificaciones del Deployment para que apunten a los endpoints correctos:
```bash
# Aplicar el manifiesto con las sondas corregidas
kubectl apply -f /home/ubuntu/s12/k8s/03-app-deployment.yaml

# Monitorear el despliegue ordenado
kubectl rollout status deployment/app -n practica-s12
```

#### 5. Verificación
Verificar que los eventos de `Unhealthy` cesen y que los pods permanezcan estables sin reinicios forzados por liveness probe:
```bash
kubectl describe pod -n practica-s12 -l app=app | grep -A 5 "Events:"
```

---

### FALLA B: Error de Red en Servicio MongoDB (TargetPort Discordante)

#### 1. Síntoma Detectado
Una vez estabilizados los pods de la aplicación, al consumir la API o la sonda de preparación, el servicio responde con error `503 Service Unavailable`:
```bash
curl -i http://localhost:30080/health/ready
```
**Respuesta observada:**
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
Content-Length: 64

{"status":"NOT_READY","mongodb":"DESCONECTADO"}
```

Y al consultar la raíz:
```bash
curl -s http://localhost:30080/ | jq .
```
```json
{
  "aplicacion": "AVSA - Practica S12 (Kubernetes en AWS)",
  "pod": "app-7df4579cc-j8s9k",
  "usuario": {
    "uid": 10001,
    "gid": 10001,
    "nombre": "appuser",
    "root": false
  },
  "mongodb": "DESCONECTADO",
  "baseDeDatos": "practica_s12",
  "visitas": "No disponible (MongoDB desconectado)"
}
```

#### 2. Diagnóstico Técnico
1. **Comprobar si el Pod de MongoDB está vivo y escuchando:**
   ```bash
   kubectl get pods -n practica-s12 -l app=mongo
   ```
   *Resultado: Pod `mongo` se encuentra `1/1 Running`.*

2. **Verificar el servicio `mongo-service` y sus Endpoints:**
   ```bash
   kubectl get svc mongo-service -n practica-s12
   kubectl describe svc mongo-service -n practica-s12
   ```
   **Salida observada:**
   ```text
   Name:              mongo-service
   Namespace:         practica-s12
   Labels:            app=mongo
   Selector:          app=mongo
   Type:              ClusterIP
   IP:                10.43.120.45
   Port:              mongodb  27017/TCP
   TargetPort:        27018/TCP    <-- [ANOMALÍA DETECTADA]
   Endpoints:         10.42.0.18:27018
   ```

3. **Verificar el puerto real del contenedor MongoDB:**
   ```bash
   kubectl get pod -n practica-s12 -l app=mongo -o jsonpath='{.items[0].spec.containers[0].ports}'
   ```
   *El contenedor expone y ejecuta `mongod` en el puerto `27017`.*

4. **Prueba de conectividad directa desde el Pod de la App:**
   ```bash
   kubectl exec -n practica-s12 deploy/app -c app -- nc -zvw3 mongo-service 27017
   # Salida: Connection refused o Timeout debido a que targetPort enruta hacia 27018
   ```

#### 3. Causa Raíz
El Service `mongo-service` tiene configurado `targetPort: 27018`. Aunque el puerto del servicio expuesto en el clúster es `27017`, `kube-proxy` redirige los paquetes TCP dirigidos a `mongo-service:27017` hacia el puerto `27018` del Pod de MongoDB, donde ningún proceso está escuchando. Esto causa un fallo de conexión inmediato (`Connection refused`), impidiendo que el driver oficial de MongoDB en Node.js establezca la sesión.

#### 4. Solución Aplicada
Se corrige la definición del servicio para que apunte al puerto correcto `27017`:
```bash
# Opción 1: Aplicar manifiesto corregido
kubectl apply -f /home/ubuntu/s12/k8s/04-app-service.yaml

# Opción 2: Corregir mediante parche en caliente
kubectl patch svc mongo-service -n practica-s12 --type='json' -p='[{"op": "replace", "path": "/spec/ports/0/targetPort", "value":27017}]'
```

#### 5. Verificación
1. **Comprobar los endpoints actualizados:**
   ```bash
   kubectl describe svc mongo-service -n practica-s12 | grep Endpoints
   # Salida esperada: Endpoints: 10.42.0.18:27017
   ```

2. **Validar sonda `/health/ready`:**
   ```bash
   curl -i http://localhost:30080/health/ready
   ```
   **Respuesta esperada:**
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json; charset=utf-8

   {"status":"READY","mongodb":"CONECTADO","database":"practica_s12"}
   ```

3. **Validar endpoint raíz y contador de visitas:**
   ```bash
   curl -s http://localhost:30080/ | jq .
   ```
   **Respuesta esperada:**
   ```json
   {
     "aplicacion": "AVSA - Practica S12 (Kubernetes en AWS)",
     "pod": "app-6d4b6899c7-kx9lp",
     "usuario": {
       "uid": 10001,
       "gid": 10001,
       "nombre": "appuser",
       "root": false
     },
     "mongodb": "CONECTADO",
     "baseDeDatos": "practica_s12",
     "visitas": 1
   }
   ```

4. **Validar persistencia de productos mediante CRUD:**
   ```bash
   # Insertar producto
   curl -X POST http://localhost:30080/api/productos \
     -H "Content-Type: application/json" \
     -d '{"nombre": "Servidor Dell PowerEdge", "precio": 3200, "stock": 5, "categoria": "Infraestructura"}'

   # Consultar productos
   curl -s http://localhost:30080/api/productos | jq .
   ```

---

## 3. Matriz de Comandos de Diagnóstico Rápido

| Objetivo del Diagnóstico | Comando `kubectl` / CLI |
| :--- | :--- |
| Ver estado general de pods y reinicios | `kubectl get pods -n practica-s12 -o wide` |
| Ver bitácora en vivo de la aplicación | `kubectl logs -n practica-s12 -l app=app --tail=50 -f` |
| Ver eventos y fallos de sondas | `kubectl describe pod -n practica-s12 -l app=app` |
| Inspeccionar variables del ConfigMap | `kubectl get cm app-config -n practica-s12 -o yaml` |
| Inspeccionar puertos de servicios y endpoints | `kubectl describe svc mongo-service -n practica-s12` |
| Validar cumplimiento de Pod Security Standards | `kubectl get ns practica-s12 --show-labels` |
| Comprobar usuario no root en contenedor | `kubectl exec -n practica-s12 deploy/app -- id` |
| Verificar sistema de archivos de solo lectura | `kubectl exec -n practica-s12 deploy/app -- touch /test.txt` *(debe fallar: Read-only file system)* |

---

## 4. Lecciones Aprendidas y Buenas Prácticas de Ingeniería

1. **Gestión Unificada de Variables de Entorno:**
   El uso de esquemas de validación estricta al inicio de las aplicaciones (como el chequeo de `DB_NAME` en `server.js`) previene fallos silenciosos en tiempo de ejecución (`fail-fast principle`).
2. **Coherencia entre Contratos de Sondas y Código:**
   Los endpoints `/health/live` y `/health/ready` deben estar debidamente desacoplados: la vitalidad (liveness) solo valida que el proceso responda, mientras que la preparación (readiness) evalúa las dependencias críticas (como MongoDB) para evitar que el tráfico sea enrutado a pods que aún no pueden procesar peticiones.
3. **Mapeo Riguroso de Puertos en Servicios de Kubernetes:**
   La disociación entre `port` (puerto del Service) y `targetPort` (puerto del Pod) requiere atención cuidadosa en arquitecturas microservicios para evitar falsos positivos de conectividad de red interna.
4. **Hardening sin Afectar la Operatividad:**
   La implementación de `readOnlyRootFilesystem: true` combinada con volúmenes `emptyDir` específicos en directorios como `/tmp` y `/var/run` permite cumplir con los estándares `restricted` del PSA garantizando la estabilidad de aplicaciones Node.js y MongoDB sin requerir permisos de `root`.
