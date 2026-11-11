const Sentry=require('@sentry/node');
if(process.env.SENTRY_DSN){
 Sentry.init({
  dsn:process.env.SENTRY_DSN,tracesSampleRate:0.1,
  dataCollection:{userInfo:false,cookies:false,httpHeaders:false,httpBodies:[],urlQueryParams:false,databaseQueryData:false,genAI:{inputs:false,outputs:false},mcp:{inputs:false,outputs:false},graphQL:{document:false,variables:false},queues:false,stackFrameVariables:false},
  beforeSend(event){delete event.user;if(event.request){delete event.request.data;delete event.request.cookies;delete event.request.headers;delete event.request.query_string;if(event.request.url)event.request.url=event.request.url.split('?')[0];}return event;}
 });
 console.log('Sentry inicializado sin cuerpos de solicitudes ni datos de cuenta.');
}
