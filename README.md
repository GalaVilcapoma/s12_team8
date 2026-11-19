# AVSA: Despliegue Cloud, Seguridad y Troubleshooting en Kubernetes (K3s) sobre AWS EC2

[![Kubernetes](https://img.shields.io/badge/Kubernetes-K3s-blue.svg?logo=kubernetes)](https://k3s.io/)
[![Cloud](https://img.shields.io/badge/AWS-EC2%20%2F%20CloudFormation-orange.svg?logo=amazon-aws)](https://aws.amazon.com/)
[![Runtime](https://img.shields.io/badge/Node.js-20%20Alpine-green.svg?logo=node.js)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/MongoDB-7.0-brightgreen.svg?logo=mongodb)](https://www.mongodb.com/)
[![Security](https://img.shields.io/badge/Security-PSA%20Restricted-red.svg)](https://kubernetes.io/docs/concepts/security/pod-security-admission/)

---

## 1. Descripción del Proyecto

El proyecto **AVSA** implementa una arquitectura cloud robusta para el despliegue, securización y diagnóstico de incidentes (troubleshooting) de una solución multicapa en **Kubernetes ligero (K3s)** provisionada sobre una instancia **AWS EC2 Ubuntu 24.04 LTS** mediante **AWS CloudFormation**.

La arquitectura está construida bajo el principio de **Mínimo Privilegio**, adhiriéndose estrictamente al perfil **`restricted`** de *Pod Security Admission (PSA)* de Kubernetes. Incorpora además un laboratorio práctico de resolución de incidentes con escenarios de fallas inyectadas en capas de **Configuración**, **Red Interna** y **Sondas de Salud**.

---

## 2. Arquitectura de la Solución (Diagrama ASCII)

```text
+---------------------------------------------------------------------------------------------------+
|                                              AWS CLOUD                                            |
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   | VPC: 10.0.0.0/16                                                                          |   |
|   | Internet Gateway <----> Route Table (0.0.0.0/0)                                           |   |
|   |                                                                                           |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   | Public Subnet: 10.0.1.0/24                                                        |   |   |
|   |   |                                                                                   |   |   |
|   |   |   +---------------------------------------------------------------------------+   |   |   |
|   |   |   | Security Group: sg-avsa-k3s                                               |   |   |   |
|   |   |   | Ingress: 22/TCP (SSH Admin), 30080/TCP (NodePort App HTTP)               |   |   |   |
|   |   |   |                                                                           |   |   |   |
|   |   |   |   +-------------------------------------------------------------------+   |   |   |   |
|   |   |   |   | AWS EC2 Instance (Ubuntu 24.04 LTS - t3.small / t3.medium)        |   |   |   |   |
|   |   |   |   | Docker Engine 26+ + K3s Kubernetes Engine                         |   |   |   |   |
|   |   |   |   | Storage: EBS gp3 (30 GB)                                          |   |   |   |   |
|   |   |   |   |                                                                   |   |   |   |
|   |   |   |   |   +-----------------------------------------------------------+   |   |   |   |
|   |   |   |   |   | Kubernetes Cluster (K3s)                                  |   |   |   |   |
|   |   |   |   |   |                                                           |   |   |   |   |
|   |   |   |   |   | Namespace: practica-s12                                   |   |   |   |   |
|   |   |   |   |   | [PSA Labels: enforce=restricted, audit=restricted]        |   |   |   |   |
|   |   |   |   |   |                                                           |   |   |   |   |
|   |   |   |   |   |   +---------------------------------------------------+   |   |   |   |   |
|   |   |   |   |   |   | Service: app-service (NodePort: 30080)            |   |   |   |   |   |
|   |   |   |   |   |   +-------------------------+-------------------------+   |   |   |   |   |
|   |   |   |   |   |                             | Port 3000                   |   |   |   |   |
|   |   |   |   |   |                             v                             |   |   |   |   |
|   |   |   |   |   |            +--------------------------------+             |   |   |   |   |
|   |   |   |   |   |            | Deployment: app (2 replicas)   |             |   |   |   |   |
|   |   |   |   |   |            | - Image: app-s12:1.0 (Alpine)  |             |   |   |   |   |
|   |   |   |   |   |            | - User: appuser (UID 10001)    |             |   |   |   |   |
|   |   |   |   |   |            | - readOnlyRootFilesystem: true |             |   |   |   |   |
|   |   |   |   |   |            | - Probes: /health/{live,ready} |             |   |   |   |   |
|   |   |   |   |   |            +----------------+---------------+             |   |   |   |   |
|   |   |   |   |   |                             |                             |   |   |   |   |
|   |   |   |   |   |        ConfigMap: app-config|Secret: db-secret            |   |   |   |   |
|   |   |   |   |   |        (DB_NAME, DB_HOST...) (DB_USER, DB_PASS)           |   |   |   |   |
|   |   |   |   |   |                             |                             |   |   |   |   |
|   |   |   |   |   |                             v                             |   |   |   |   |
|   |   |   |   |   |   +---------------------------------------------------+   |   |   |   |   |
|   |   |   |   |   |   | Service: mongo-service (ClusterIP: 27017)         |   |   |   |   |   |
|   |   |   |   |   |   +-------------------------+-------------------------+   |   |   |   |   |
|   |   |   |   |   |                             | Port 27017                  |   |   |   |   |
|   |   |   |   |   |                             v                             |   |   |   |   |
|   |   |   |   |   |            +--------------------------------+             |   |   |   |   |
|   |   |   |   |   |            | Deployment: mongo (1 replica)  |             |   |   |   |   |
|   |   |   |   |   |            | - Image: mongo:7.0             |             |   |   |   |   |
|   |   |   |   |   |            | - User: UID 10001, GID 10001   |             |   |   |   |   |
|   |   |   |   |   |            | - readOnlyRootFilesystem: true |             |   |   |   |   |
|   |   |   |   |   |            | - TCP Probes: 27017            |             |   |   |   |   |
|   |   |   |   |   |            +----------------+---------------+             |   |   |   |   |
|   |   |   |   |   |                             |                             |   |   |   |   |
|   |   |   |   |   |                             v Mount: /data/db             |   |   |   |   |
|   |   |   |   |   |   +---------------------------------------------------+   |   |   |   |   |
|   |   |   |   |   |   | PVC: mongo-pvc (1Gi, ReadWriteOnce)               |   |   |   |   |   |
|   |   |   |   |   |   +---------------------------------------------------+   |   |   |   |   |
|   |   |   |   |   +-----------------------------------------------------------+   |   |   |   |
|   |   |   |   +-------------------------------------------------------------------+   |   |   |
|   |   |   +---------------------------------------------------------------------------+   |   |
|   |   +-----------------------------------------------------------------------------------+   |
|   +-------------------------------------------------------------------------------------------+
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Estructura de Carpetas y Manifiestos

```text
.
├── README.md                           # Documentación técnica general y guía de operación
├── despliegue-aws/
│   └── s12-k3s.yaml                    # Plantilla CloudFormation (VPC, SG, EC2, UserData automatizado)
├── docs/
│   └── troubleshooting-log.md          # Bitácora técnica de diagnóstico y resolución de fallas A, B y C
├── escenarios/
│   └── con-fallas/                     # Manifiestos con 3 fallas inyectadas para pruebas de laboratorio
│       ├── 01-security-configmap.yaml  # [Falla A] Clave DATABASE_NAME en vez de DB_NAME
│       ├── 03-app-deployment.yaml      # [Falla C] Sondas apuntando a /healthz y /ready (404)
│       └── 04-app-service.yaml         # [Falla B] mongo-service targetPort 27018 en vez de 27017
├── k8s/                                # Manifiestos 100% funcionales y securizados (Golden State)
│   ├── 00-namespace.yaml               # Namespace practica-s12 con PSA Restricted
│   ├── 01-security-configmap.yaml      # ConfigMap con variables de entorno correctas
│   ├── 02-db-secret.yaml               # Secret con credenciales en Base64
│   ├── 03-app-deployment.yaml          # PVC 1Gi, Deployments de mongo y app con Hardening
│   └── 04-app-service.yaml             # ClusterIP (27017) y NodePort (30080)
└── src/                                # Código fuente de la aplicación Node.js
    ├── Dockerfile                      # Imagen multi-stage / Alpine ejecutando como appuser (10001)
    ├── package.json                    # Dependencias: Express y MongoDB Driver oficial
    └── server.js                       # Servidor HTTP con validación fail-fast y endpoints REST
```

---

## 4. Tabla de Hardening de Seguridad (Restricted PSA)

Ambos despliegues (`app` y `mongo`) implementan las directrices más estrictas de Kubernetes Pod Security Standards:

| Capa de Seguridad | Parámetro Configurado | Valor Establecido | Justificación Técnica |
| :--- | :--- | :--- | :--- |
| **Namespace PSA** | `pod-security.kubernetes.io/enforce` | `restricted:latest` | Bloquea el despliegue de cualquier pod con privilegios root o capacidades Linux no autorizadas. |
| **Pod Security** | `runAsNonRoot` | `true` | Obliga a que ningún proceso dentro del pod inicie como usuario con UID 0 (root). |
| **Pod Security** | `runAsUser` / `runAsGroup` | `10001` / `10001` | Asigna el usuario y grupo no privilegiado `appuser` tanto en la app como en MongoDB. |
| **Pod Security** | `fsGroup` | `10001` | Asigna automáticamente permisos de escritura en los volúmenes montados al GID `10001`. |
| **Pod Security** | `seccompProfile` | `type: RuntimeDefault` | Restringe llamadas al sistema del kernel de Linux únicamente al perfil seguro del runtime. |
| **Container Security**| `readOnlyRootFilesystem` | `true` | Bloquea escrituras en el sistema de archivos raíz del contenedor, mitigando malware y persistencia indebida. |
| **Container Security**| `allowPrivilegeEscalation` | `false` | Impide que binarios ejecutados dentro del contenedor (e.g. SUID) eleven privilegios. |
| **Container Security**| `capabilities.drop` | `["ALL"]` | Elimina todas las capacidades del kernel de Linux (e.g. `CAP_NET_RAW`, `CAP_SYS_ADMIN`). |
| **Volúmenes Temporales**| `emptyDir: {}` | `/tmp`, `/var/run`, `/home/appuser` | Permite escribir sockets, caches y temporales en memoria o disco efímero sin quebrar el filesystem de solo lectura. |

---

## 5. Tabla de Troubleshooting (Laboratorio de Fallas)

| Falla | Tipo / Capa | Manifiesto con Falla | Síntoma en el Clúster | Causa Raíz | Solución Aplicada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Falla A** | **Configuración** | `escenarios/con-fallas/01-security-configmap.yaml` | Pods en `CrashLoopBackOff`, error en logs: `[ERROR FATAL] DB_NAME no está definida`. | El ConfigMap define la clave `DATABASE_NAME` en vez de `DB_NAME`. | Aplicar `k8s/01-security-configmap.yaml` con la clave correcta `DB_NAME` y reiniciar el deployment. |
| **Falla B** | **Red Interna** | `escenarios/con-fallas/04-app-service.yaml` | `/health/ready` devuelve HTTP `503`, `mongodb: "DESCONECTADO"`, timeout hacia la BD. | `mongo-service` redirige a `targetPort: 27018` en vez de `27017` donde escucha MongoDB. | Aplicar `k8s/04-app-service.yaml` corrigiendo `targetPort: 27017`. |
| **Falla C** | **Sondas de Salud**| `escenarios/con-fallas/03-app-deployment.yaml` | Pods en `0/1 Ready`, eventos `Unhealthy` con statuscode `404`, reinicios periódicos. | `livenessProbe` y `readinessProbe` apuntan a `/healthz` y `/ready` (rutas no registradas en Express). | Aplicar `k8s/03-app-deployment.yaml` con las rutas válidas `/health/live` y `/health/ready`. |

*Para el análisis detallado paso a paso con comandos de depuración y logs de eventos, consulte [docs/troubleshooting-log.md](file:///d:/tareaaaaa/docs/troubleshooting-log.md).*

---

## 6. Pasos de Despliegue en AWS

### Prerrequisitos
- Cuenta de AWS con permisos para crear VPC, Subnets, Internet Gateways, Security Groups e instancias EC2.
- AWS CLI instalado y configurado (`aws configure`) o consola de AWS CloudFormation.
- KeyPair existente en AWS (opcional, si se desea acceder vía SSH).

### Paso 1: Lanzar el Stack de CloudFormation
Ejecute el siguiente comando con AWS CLI indicando su región y KeyPair:
```bash
aws cloudformation create-stack \
  --stack-name avsa-k3s-stack \
  --template-body file://despliegue-aws/s12-k3s.yaml \
  --parameters ParameterKey=InstanceType,ParameterValue=t3.medium \
               ParameterKey=KeyName,ParameterValue="mi-keypair" \
               ParameterKey=SSHLocation,ParameterValue="0.0.0.0/0" \
  --region us-east-1
```

### Paso 2: Monitorear la Creación de la Infraestructura
```bash
aws cloudformation wait stack-create-complete \
  --stack-name avsa-k3s-stack \
  --region us-east-1
```

Obtener la IP pública y la URL del servicio desde las salidas (Outputs) del Stack:
```bash
aws cloudformation describe-stacks \
  --stack-name avsa-k3s-stack \
  --query "Stacks[0].Outputs" \
  --output table
```

### Paso 3: Verificar la Bitácora de Provisión en la Instancia EC2
Conéctese vía SSH y verifique el log de instalación automatizado:
```bash
ssh ubuntu@<IP_PUBLICA_EC2>

# Visualizar el progreso de UserData
sudo cat /var/log/s12.log | grep -E "\[S12\]"
```

El log culminará indicando el mensaje final requerido:
```text
=========================================================
[S12] S12 LISTO
=========================================================
```

---

## 7. Procedimiento de Resolución del Escenario con Fallas

Una vez que la instancia finaliza su provisión, el entorno arranca deliberadamente con el **escenario con fallas**. Siga estos pasos desde la consola de la instancia EC2 para diagnosticar y recuperar el estado óptimo:

### 1. Diagnóstico Inicial
```bash
# Ver estado de los pods (se observará CrashLoopBackOff por Falla A)
kubectl get pods -n practica-s12

# Ver los logs del pod de la aplicación
kubectl logs -n practica-s12 -l app=app --tail=20
```

### 2. Corregir Falla A (ConfigMap)
```bash
# Aplicar el ConfigMap correcto
kubectl apply -f /home/ubuntu/s12/k8s/01-security-configmap.yaml

# Reiniciar pods de la app
kubectl rollout restart deployment/app -n practica-s12
```

### 3. Diagnosticar y Corregir Falla C (Sondas de Salud 404)
```bash
# Inspeccionar eventos de las sondas fallidas
kubectl describe pod -n practica-s12 -l app=app | grep -E "Warning|Unhealthy"

# Aplicar el Deployment con las rutas de salud correctas (/health/live y /health/ready)
kubectl apply -f /home/ubuntu/s12/k8s/03-app-deployment.yaml

# Esperar la actualización de los pods
kubectl rollout status deployment/app -n practica-s12
```

### 4. Diagnosticar y Corregir Falla B (Red / targetPort de MongoDB)
```bash
# Verificar servicio de MongoDB (se observará targetPort: 27018)
kubectl describe svc mongo-service -n practica-s12 | grep -E "Port|TargetPort|Endpoints"

# Aplicar el servicio corregido con targetPort: 27017
kubectl apply -f /home/ubuntu/s12/k8s/04-app-service.yaml
```

---

## 8. Comandos de Validación de la Solución

Una vez aplicadas las correcciones, verifique el correcto funcionamiento de cada componente:

### 1. Verificar Estado General de los Recursos en Kubernetes
```bash
kubectl get all -n practica-s12
```
*Salida esperada: Pods `mongo` (1/1) y `app` (1/1, 2 réplicas) en estado `Running`.*

### 2. Validar Cumplimiento de Políticas de Seguridad (Hardening)
```bash
# Verificar que el proceso corra con UID 10001 y NO como root:
kubectl exec -n practica-s12 deploy/app -c app -- id
# Salida esperada: uid=10001(appuser) gid=10001(appgroup)

# Comprobar que el sistema de archivos raíz es de solo lectura:
kubectl exec -n practica-s12 deploy/app -c app -- touch /app/hack.txt
# Salida esperada: touch: /app/hack.txt: Read-only file system
```

### 3. Validar Sondas de Salud HTTP
```bash
# Sonda de Vitalidad (Liveness):
curl -i http://localhost:30080/health/live
# Respuesta HTTP 200 OK: {"status":"ALIVE","uptime":...}

# Sonda de Preparación (Readiness):
curl -i http://localhost:30080/health/ready
# Respuesta HTTP 200 OK: {"status":"READY","mongodb":"CONECTADO","database":"practica_s12"}
```

### 4. Validar Endpoint Principal y Contador de Visitas
```bash
curl -s http://localhost:30080/ | jq .
```
**Respuesta JSON esperada:**
```json
{
  "aplicacion": "AVSA - Practica S12 (Kubernetes en AWS)",
  "pod": "app-78b9b4f9-2x4j9",
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

### 5. Validar Operaciones CRUD de Productos en MongoDB
```bash
# 1. Crear un producto vía POST
curl -X POST http://localhost:30080/api/productos \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Firewall Cisco Firepower",
    "precio": 4500,
    "stock": 10,
    "categoria": "Seguridad Perimetral",
    "descripcion": "Next-Gen Firewall para protección de infraestructura cloud"
  }' | jq .

# 2. Listar productos almacenados vía GET
curl -s http://localhost:30080/api/productos | jq .
```

---

## 9. Contacto y Mantenimiento

- **Autor:** Equipo de Infraestructura y Cloud Security - AVSA
- **Entorno:** Kubernetes K3s sobre AWS EC2 (Ubuntu 24.04 LTS)
- **Licencia:** MIT
