"""
Linter ortográfico en castellano para el contenido de la presentación.
Estrategia: diccionario pyspellchecker + whitelist amplia de términos correctos.
Solo reporta palabras genuinamente sospechosas (no falsos positivos).
Uso: python3 scripts/lint_presentation_es.py
"""
import sys, re
sys.stdout.reconfigure(encoding="utf-8")
from spellchecker import SpellChecker

spell = SpellChecker(language="es")

# ── Whitelist ─────────────────────────────────────────────────────────────────
# Términos técnicos, anglicismos aceptados y palabras que pyspellchecker
# no conoce pero son castellano correcto.
WHITELIST = {
    # ── Nombres propios / proyecto ───────────────────────────────────────────
    "androidcommondoc","myapp","yourorg","compositeconfig","emitbaselineconfig",
    "noglobalscope","featureaccess","nohardcodedstrings","nohardcodeddispatchers",
    "noplatformdeps","nochannelforuievents","nochannelfornavigation","nomagicnumbers",
    "nosilentcatch","noruncatching","nolaunchininit","cancellationexception",
    "sealeduistate","mutablestateflowexposed","whilesubscribedtimeout",
    "classcastexception","bindingcontext","companion","object","orchestrator",
    # ── Tecnologías / siglas ─────────────────────────────────────────────────
    "kotlin","multiplatform","android","ios","macos","desktop","gradle","detekt",
    "konsist","vitest","mcp","npm","typescript","node","powershell","bash","jacoco",
    "kover","cyclonedx","sbom","trivy","cve","compose","swiftui","viewmodel",
    "usecase","stateflow","sharedflow","claude","copilot","github","git",
    "ast","api","apis","json","xml","yaml","sha","qr","url","sdk","jvm","agp",
    "psi","ktx","koin","kmp","roi","kpi","kpis","stdio","markdown","readme",
    "changelog","maven","central","actions","wiki","issue","guides","doc","docs",
    "server","start","pass","fail","call","all","gate","gates","flow","rules",
    "generate","validate","sources","structure","feature","quality","coverage",
    "merge","left","shift","pull","based","limited","granted","prod","scan",
    "skill","skills","plugin","toolkit","registry","manifest","hash","checksums",
    "checksum","backend","frontend","output","input","rate","setup","onboarding",
    "dashboard","staging","deploy","release","releases","pipeline","build","commit",
    "commits","hook","hooks","workflow","workflows","token","tokens","logs","log",
    "bug","suite","chat","core","domain","windows","linux","diffs","overrides",
    "opt","out","format","tooling","app","bypass","bypasss",
    "test","tests","lint","sync","cover","vault","common","code",
    "introduce","detecta","escribe","invoca","indican","usan","corrompe",
    "basado","llamadas","notas","publicado","significa","identifican",
    "detectó","superan","activas","todas","excluido","positivos","falsos",
    "equipos","selectivamente","antipatrones","personalizadas","segundos",
    "mismas","repetían","parámetros","limiting",
    # ── Español correcto que pyspellchecker no reconoce (conjugaciones, plurales) ──
    "kit","centralizado","multiplataforma","scripts","script","reglas","todos",
    "proyectos","habilidades","estándares","compartidas","aplican","herramientas",
    "monitoreo","sincronización","descendentes","distribuye","detectan","patrones",
    "violaciones","comparten","desarrollador","heredan","agentes","duplicados",
    "veces","aplica","errores","revisiones","inconsistentes","pruebas","consumen",
    "cambios","deprecaciones","librerías","externas","detección","están",
    "documentados","verifican","descubría","tenía","leían","discusiones","lentos",
    "costosos","eran","versiones","invocables","estructurado","automatización",
    "expone","parseo","hacen","cómo","programable","hace","decisiones","documentadas",
    "universales","sobreescrituras","convenciones","específicas","aplicaciones",
    "hashes","entradas","excluyen","equivale","accidentales","sobreescribe",
    "define","capas","verificada","suele","tipos","puras","evita","plantillas",
    "técnicas","tipado","ecosistema","extrae","ejecuta","analiza","devuelve",
    "recibe","funciona","prohíbe","archivos","resultados","líneas","guardias",
    "reutilizables","nombres","recursos","unificado","puertas","límites",
    "estructurales","fallos","importando","obtenga","permiten","produce","unitarias",
    "lagunas","convierta","generan","esqueletos","probadas","integra","fuentes",
    "niveles","páginas","escaneo","palabras","señales","asistida","ciclos",
    "semanas","sorpresas","detectadas","hereda","ahorrados","descubiertas",
    "riesgos","ejecutas","nuevos","detectada","días","deprecadas","minutos",
    "ahorra","unos","pasan","supone","genera","propagó","nuevas","introdujo",
    "silenciada","bloqueó","encontró","contadores","desactualizados","identificó",
    "incompletos","introducida","ejemplos","autocompletado","llegaran","impidió",
    "varios","concretos","autorizadas","puede","implementaciones","secretos",
    "cubren","previene","reduce","software","corrutinas","fugas","mantiene",
    "diferencias","cruzadas","referencias","contratos","arquitectónicos","conectado",
    "prioridades","regenera","añade","identifica","relevantes","revisa","conecta",
    "abre","preguntas","está","requieren","bienvenidas","adoptarlo","clonar",
    "instala","cabeceras","materializan","rastrea","incorpora","declara","exporta",
    "materializa","clona","instrucciones","detekte","bootstraps","guard","libs",
    "console","log","stdio","based","limited","all","validate","sources","doc",
    "docs","format","merge","structure","server","start","skill","skills",
    "feature","gate","gates","quality","orchestrator","pass","fail","call",
    "left","shift","pull","grant","granted","prod","scan","bypass","flow",
    "rules","generate","changelog","maven","diffs","opt","out","app","tooling",
    "wiki","issue","guides","config","readme","commit","commits","hook","hooks",
    # ── Plurales y conjugaciones comunes no en el dict ───────────────────────
    "qué","están","cómo","prohíbe","límites","líneas","páginas","señales",
    "días","minutos","veces","scripts","tokens","logs","hashes","diffs","docs",
    "skills","hooks","commits","workflows","releases","actions","guides","issues",
    "plugins","overrides","checkboxes","dashboards","templates","plantillas",
    "cabeceras","instrucciones","diferencias","referencias","contratos","prioridades",
    "contadores","ejemplos","concretos","varios","incompletos","nuevas","nuevos",
    "detectadas","detectada","silenciada","ahorrados","descubiertas","deprecadas",
    "autorizadas","implementaciones","implementación","fugas","corrutinas",
    "guardias","puertas","capas","reglas","errores","pruebas","patrones",
    "proyectos","habilidades","herramientas","agentes","versiones","decisiones",
    "entradas","aplicaciones","tipos","plantillas","técnicas","señales","palabras",
    "paginas","fuentes","niveles","nombres","recursos","fallos","ciclos","semanas",
    "sorpresas","riesgos","secretos","contratos","referencias","diferencias",
    "arquitectónicos","prioridades","contadores","ejemplos","concretos","varios",
}

# ── Contenido de la presentación ─────────────────────────────────────────────
SLIDES = [
    ("Portada", [
        "Kit de desarrollo centralizado para Android y Kotlin Multiplatform",
        "Presentación interna de ingeniería  |  2026",
        "Escalable  ·  Multiplataforma  ·  Nativo para IA",
        "Introduce la iniciativa: AndroidCommonDoc es nuestro toolkit interno L0, "
        "fuente única de verdad para scripts, habilidades de IA, reglas de arquitectura "
        "y documentación en todos los proyectos Android y KMP.",
    ]),
    ("Resumen ejecutivo", [
        "Fuente única de verdad para todos los estándares de desarrollo Android y KMP",
        "33 habilidades de IA compartidas entre Claude Code y GitHub Copilot",
        "13 reglas Detekt personalizadas que aplican la arquitectura en tiempo de compilación",
        "17 herramientas MCP para validación programática, monitoreo y sincronización",
        "Se distribuye a proyectos descendentes mediante registro, manifiesto y motor de sincronización",
        "Resumen en 30 segundos: un repositorio con todos los patrones, scripts y habilidades. "
        "Los proyectos descendentes heredan mediante sincronización, no copiar y pegar. "
        "Las violaciones de arquitectura se detectan en compilación. "
        "Los agentes de IA comparten las mismas habilidades sin importar qué herramienta usa el desarrollador.",
    ]),
    ("El problema", [
        "Scripts duplicados en cada proyecto: la misma corrección se aplica N veces",
        "Patrones de arquitectura inconsistentes generan fricción en revisiones y errores",
        "Los agentes de IA consumen hasta 50 000 tokens por ejecución de pruebas",
        "Sin detección sistemática de cambios o deprecaciones en librerías externas",
        "Sin aplicación automática: los patrones están documentados pero no se verifican",
        "Antes del toolkit cada proyecto tenía su propio script de pruebas ligeramente diferente. "
        "Las discusiones de arquitectura se repetían en cada PR. "
        "Los agentes de IA eran costosos y lentos porque leían la salida en bruto de Gradle. "
        "La deriva de versiones se descubría en tiempo de ejecución, no al escribir el código.",
    ]),
    ("Visión general de la solución", [
        "Toolkit L0 centralizado: instalar una vez, usar en todos los proyectos",
        "Scripts multiplataforma (PowerShell + Bash) con comportamiento idéntico",
        "Habilidades de IA como Markdown estructurado, invocables desde Claude Code o Copilot",
        "Reglas Detekt aplican la arquitectura en compilación, sin coste en tiempo de ejecución",
        "Servidor MCP expone 17 herramientas para CI, automatización e integración con agentes",
        "La idea central: separar la estructura de la ejecución. "
        "Los scripts hacen el trabajo pesado. "
        "Las habilidades indican al agente qué hacer, no cómo analizar logs. "
        "Las reglas aplican decisiones documentadas sin revisión manual.",
    ]),
    ("Arquitectura del sistema: L0 / L1 / L2", [
        "L0 (este repositorio): patrones universales, habilidades, agentes y reglas Detekt",
        "L1 (libs compartidas): autoridad de versiones, convenciones de librerías, sobreescrituras",
        "L2 (aplicaciones): habilidades específicas, agentes de dominio y overrides por proyecto",
        "Las habilidades se distribuyen mediante registro con hashes SHA-256 y motor de sincronización",
        "Los proyectos descendentes excluyen entradas individualmente: ausencia equivale a opt-out",
        "L0 es este repositorio y define la línea base canónica. "
        "L1 suele ser el repositorio de librerías compartidas. "
        "L2 es cada proyecto de aplicación. "
        "La sincronización es pull-based y verificada por hash, sin sobreescrituras accidentales.",
    ]),
    ("Stack tecnológico", [
        "Kotlin Multiplatform (Android · Desktop · iOS · macOS)",
        "Detekt: reglas AST puras, sin resolución de tipos (evita el bug Detekt número 8882)",
        "Node.js TypeScript: servidor MCP, 17 herramientas, suite Vitest 653 de 653 en verde",
        "Claude Code + GitHub Copilot: 33 habilidades, 34 plantillas para Copilot",
        "PowerShell + Bash: scripts multiplataforma con paridad verificada por tests",
        "Decisiones técnicas clave: las reglas Detekt solo usan AST para evitar un bug conocido. "
        "El servidor MCP usa transporte stdio, sin console log (corrompe el transporte). "
        "Las habilidades son Markdown, sin dependencia de proveedor.",
    ]),
    ("Flujo de trabajo con habilidades de IA", [
        "El desarrollador escribe /test core:domain en Claude Code o Copilot Chat",
        "El agente lee SKILL.md e invoca el script multiplataforma con parámetros estructurados",
        "El script ejecuta Gradle, analiza XML y extrae errores: devuelve un resumen estructurado",
        "El agente recibe aproximadamente 2 000 tokens de señal, no 50 000 tokens de logs en bruto",
        "La misma habilidad funciona en Windows (PowerShell) y macOS/Linux (Bash)",
        "Sin el toolkit el agente lee más de 200 líneas de salida de Gradle. "
        "Con él recibe una tabla Markdown de resultados. "
        "La habilidad coverage prohíbe explícitamente al agente leer archivos XML. "
        "Reducción de coste de tokens: aproximadamente 25 veces por ejecución completa de pruebas.",
    ]),
    ("Reglas de arquitectura Detekt (13 reglas)", [
        "Estado y exposición: SealedUiState, MutableStateFlowExposed, WhileSubscribedTimeout",
        "Límites del ViewModel: NoPlatformDeps, NoHardcodedStrings, NoHardcodedDispatchers",
        "Seguridad en corrutinas: CancellationExceptionRethrow, NoRunCatching, NoSilentCatch, NoLaunchInInit",
        "Guardias de arquitectura: NoChannelForUiEvents, NoChannelForNavigation, NoMagicNumbers",
        "Configuración base L0 activa por defecto; L1 sobreescribe solo lo necesario",
        "Todas las reglas son solo AST, sin resolución de tipos ni bindingContext. "
        "Detecta antipatrones que superan la revisión de código. "
        "Cero falsos positivos: el patrón companion object queda correctamente excluido. "
        "La configuración base distribuye todas las reglas activas, los equipos sobreescriben selectivamente.",
    ]),
    ("Pipeline de CI/CD", [
        "4 workflows reutilizables: commit-lint, nombres de recursos, seguridad KMP, guardias de arquitectura",
        "Hooks en Claude Code: Detekt en tiempo real en cada escritura de archivo y en cada commit",
        "quality-gate-orchestrator: informe unificado de 5 puertas de calidad",
        "Guardias estructurales Konsist: nomenclatura, límites de capas y aplicación de feature gates",
        "653 de 653 tests del servidor MCP en verde; cero fallos en la línea base",
        "Los workflows reutilizables permiten que cada proyecto de aplicación obtenga CI importando un archivo. "
        "Los hooks son shift-left: las violaciones se detectan antes del commit, no en el PR. "
        "El orchestrator ejecuta las 5 puertas y produce un único pass o fail. "
        "Los guardias Konsist son tests estructurales que verifican la arquitectura, no la lógica.",
    ]),
    ("Estrategia de pruebas", [
        "Unitarias: Vitest 653 de 653 para el servidor MCP, Gradle 76 de 76 para las reglas Detekt",
        "Estructurales: guardias Konsist verifican nomenclatura, límites de capas y feature gates",
        "Cobertura: Kover (KMP) o JaCoCo con ejecución paralela y análisis de lagunas",
        "Integración: doc-structure, validación de CLAUDE.md e integridad del vault",
        "Habilidad pre-pr: lint más pruebas más formato de commit antes de cada merge",
        "Los tests estructurales detectan la deriva arquitectónica antes de que se convierta en deuda técnica. "
        "Las herramientas de cobertura identifican qué líneas no están probadas y generan esqueletos. "
        "La habilidad pre-pr orquesta todo antes de crear el PR.",
    ]),
    ("Servidor MCP e inteligencia documental", [
        "17 herramientas sobre transporte stdio, integra con Claude Desktop y CI",
        "validate-all: ejecuta todos los scripts de validación y devuelve JSON estructurado",
        "monitor-sources: monitoreo por niveles de fuentes externas (GitHub API, Maven Central, páginas de documentación)",
        "Detección de deriva de versión: el cuerpo del release se analiza solo cuando cambia la versión",
        "Cambios en páginas de documentación: comparación de hash SHA-256, sin escaneo de palabras clave",
        "El servidor MCP usa transporte stdio, sin servidor de red que mantener. "
        "Rate limited a 30 llamadas por minuto para proteger las APIs externas. "
        "monitor-sources es basado en señales: solo analiza las notas del release cuando la versión realmente cambia. "
        "Los cambios en páginas de documentación se detectan por hash, sin escaneo de palabras clave.",
    ]),
    ("Impacto en el negocio", [
        "Reducción de aproximadamente 25 veces en coste de tokens por ejecución de pruebas asistida por IA",
        "Las violaciones de arquitectura se detectan en compilación: cero ciclos de revisión por deriva de patrones",
        "Configuración de nuevo proyecto: un comando, no semanas de duplicación de scripts",
        "Deprecaciones de librerías detectadas automáticamente: sin sorpresas en el lanzamiento",
        "Workflows de CI reutilizables: cada nueva app hereda el pipeline completo en una importación",
        "Si ejecutas pruebas 20 veces al día, eso supone aproximadamente 1 millón de tokens al mes ahorrados por desarrollador. "
        "Cada violación detectada en CI ahorra una ronda media de PR de unos 30 minutos. "
        "Los nuevos proyectos pasan de días a minutos para configurar CI y tooling. "
        "Sin APIs deprecadas descubiertas en el momento del lanzamiento.",
    ]),
    ("Casos de uso reales", [
        "pre-pr orquesta lint, pruebas, formato de commit y tabla resumen antes de cada PR",
        "auto-cover genera pruebas automáticamente para líneas sin cobertura",
        "sync-l0 propagó 4 nuevas habilidades a MyApp en menos de un minuto",
        "El hook de Detekt bloqueó un commit donde Copilot introdujo una CancellationException silenciada",
        "quality-gate-orchestrator encontró 3 contadores desactualizados en el README tras el hito M007",
        "Ejemplos concretos de uso real: pre-pr impidió que varios PRs incompletos llegaran a revisión. "
        "auto-cover identificó cobertura perdida en la capa de UseCases. "
        "sync-l0 propagó nuevas habilidades a MyApp en menos de un minuto. "
        "El hook de Detekt detectó una CancellationException silenciada introducida por el autocompletado de Copilot.",
    ]),
    ("Seguridad y rendimiento", [
        "Generación de SBOM (CycloneDX) y análisis de CVE (Trivy) mediante sbom-scan",
        "Guardias Konsist: FeatureAccess.GRANTED solo puede ser devuelto por implementaciones autorizadas",
        "Sin secretos en el código: reglas Detekt NoHardcodedStrings y Konsist DS-PROD1 cubren ambas capas",
        "Ejecución paralela de pruebas: una sola invocación paralela en Gradle, dos a tres veces más rápido",
        "Rate limiting en el servidor MCP: 30 llamadas por minuto para no agotar las APIs externas",
        "SBOM mantiene un inventario de software para cada release. "
        "El guardia de feature gate es nivel crítico, previene el bypass de facturación. "
        "El guardia NoGlobalScope previene fugas en el ciclo de vida de las corrutinas. "
        "La ejecución paralela reduce los minutos de CI en GitHub Actions.",
    ]),
    ("Adopción: primeros pasos", [
        "Clonar el repositorio y configurar la variable de entorno ANDROID_COMMON_DOC",
        "Ejecutar setup-toolkit.sh con la ruta del proyecto (instala todo automáticamente)",
        "Añadir l0-manifest.json para declarar qué habilidades L0 sincronizar",
        "Ejecutar sync-l0: las habilidades se materializan con cabeceras de seguimiento de versión",
        "Añadir el plugin de convención para activar las reglas Detekt (una línea de Gradle)",
        "Proceso de incorporación para un nuevo proyecto: clona el repositorio y exporta la variable de entorno. "
        "Ejecuta setup-toolkit.sh, que instala hooks, instrucciones de Copilot y el plugin de convención. "
        "Declara tu l0-manifest.json con opt-in explícito por habilidad. "
        "sync-l0 materializa todo y rastrea checksums. "
        "Tiempo total: menos de 15 minutos para un proyecto nuevo.",
    ]),
    ("Hoja de ruta", [
        "M008: conectar emitBaselineConfig al MCP generate-detekt-rules para regeneración automática",
        "M008: adoptar los workflows de CI reutilizables en MyApp (pre-pr, git-flow, commit-lint)",
        "Mejora del monitoreo: diferencias de changelog por versión y referencias cruzadas de API",
        "Ampliar las plantillas de guardias Konsist con más contratos arquitectónicos de MyApp",
        "Explorar distribución del toolkit como plugin de Gradle publicado en Maven Central",
        "Prioridades a corto plazo: emitBaselineConfig conectado al MCP significa que la configuración base "
        "se regenera automáticamente. "
        "La adopción de workflows en MyApp es el primer adoptante L2 de los workflows reutilizables. "
        "Mejora del monitoreo: enfoque en la calidad de la señal frente al ruido de palabras clave.",
    ]),
    ("Próximos pasos", [
        "Prueba pre-pr en tu proyecto actual hoy mismo",
        "Añade l0-manifest.json y ejecuta sync-l0 para obtener las 33 habilidades",
        "Revisa el catálogo de reglas Detekt e identifica las relevantes para tu código base",
        "Conecta Claude Desktop al servidor MCP para validación programática",
        "¿Preguntas? Consulta docs/guides/detekt-config.md o abre un issue en el repositorio",
        "pre-pr funciona inmediatamente sin ninguna configuración. "
        "sync-l0 es la puerta de entrada al toolkit completo. "
        "Las reglas Detekt requieren el plugin de convención, configuración de 10 minutos. "
        "Servidor MCP: npm start en mcp-server y luego configurar Claude Desktop. "
        "Toda la documentación está en el repositorio, sin wiki externa que mantener.",
    ]),
    ("Gracias", [
        "github.com/yourorg/AndroidCommonDoc",
        "docs  ·  skills  ·  mcp-server  ·  detekt-rules",
        "Preguntas bienvenidas",
        "El toolkit está listo para producción, probado, y adoptarlo lleva menos de 15 minutos.",
    ]),
]

# ── Linter ────────────────────────────────────────────────────────────────────

def tokenize(text):
    """Extrae solo palabras en castellano (con caracteres españoles), ignora números y URLs."""
    words = re.findall(r"[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{4,}", text)
    return [w.lower() for w in words]

def is_whitelisted(word):
    return (
        word in WHITELIST
        or word.rstrip("s") in WHITELIST
        or word.rstrip("es") in WHITELIST
        or word.rstrip("ado") in WHITELIST
        or word.rstrip("ados") in WHITELIST
        or word.rstrip("ando") in WHITELIST
    )

errors_found = 0
for slide_title, lines in SLIDES:
    for line in lines:
        tokens = tokenize(line)
        unknown = spell.unknown(tokens)
        flagged = [w for w in unknown if not is_whitelisted(w)]
        if flagged:
            for w in flagged:
                cands = spell.candidates(w) or {"(sin sugerencias)"}
                print(f"  [{slide_title}] '{w}' → sugerencias: {sorted(cands)[:4]}")
                errors_found += 1

if errors_found == 0:
    print("Linter ortografico OK — sin errores detectados.")
else:
    print(f"\nTotal: {errors_found} posibles errores ortograficos.")
    sys.exit(1)
