import type { tour as en } from "../en/tour.ts";

export const tour: Record<keyof typeof en, string> = {
	"tour.welcome.title": "Empieza aquí",
	"tour.welcome.body": "Este es tu inicio. La enseñanza, la práctica y el grafo de conocimiento de lo que sabes arrancan en esta pantalla.",

	"tour.composer.title": "Empieza una lección",
	"tour.composer.body": "Escribe lo que quieres aprender y envíalo. Eso abre una sesión de enseñanza. No se guarda nada hasta que envías.",

	"tour.mode.title": "Enseñar o practicar",
	"tour.mode.body": "Enseñar abre una lección. Practicar te pregunta, y puedes fijar proposiciones del grafo antes de empezar.",

	"tour.chains.title": "Cadenas de razonamiento",
	"tour.chains.body": "Cadenas lista cada cadena de tu grafo de conocimiento. Sigue vacía hasta que una lección o una importación añade proposiciones.",

	"tour.import.title": "Importar notas",
	"tour.import.body": "Trae notas en Markdown o PDF, o una carpeta entera. Las notas importadas empiezan a llenar el grafo antes de la primera lección.",

	"tour.newSessions.title": "Dos maneras de empezar",
	"tour.newSessions.body": "Enseñanza y Práctica abren un borrador. La sesión se crea al enviar el primer mensaje, igual que el compositor de inicio.",

	"tour.sessions.title": "Tus sesiones",
	"tour.sessions.body": "Las lecciones que empiezas aparecen aquí. Busca en la lista, o fíltrala por enseñanza, práctica o ambas.",

	"tour.settings.title": "Los modelos están en Ajustes",
	"tour.settings.body": "Una sesión no puede empezar hasta que elijas los modelos. Ajustes es donde los configuras, y donde se afina el resto de la aplicación.",
};
