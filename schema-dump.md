# Schema dump — rtp_blog

## users

Muestreados: 2 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| username | string | no |
| email | string | no |
| password | string | no |
| role | string | no |
| isActive | boolean | no |
| createdAt | Date | no |
| updatedAt | Date | no |
| __v | number | no |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "6848ee854e080e0d24be0a04",
  "username": "admin",
  "email": "admin@ratapan.dev",
  "password": "$2b$12$g8aLAMq94Pg8Yn5E5X99gOmhBuXvUbiMlbjZ0wdQzDiWaKmzUmzl.",
  "role": "admin",
  "isActive": true,
  "createdAt": "2025-06-11T02:48:37.989Z",
  "updatedAt": "2025-06-11T02:48:37.989Z",
  "__v": 0
}
```
</details>

## blogs

Muestreados: 3 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| title | string | no |
| slug | string | no |
| excerpt | string | no |
| status | string | no |
| mainImage | string | no |
| content | array<object> | no |
| publishedAt | Date, string | no |
| createdAt | Date, string | no |
| updatedAt | Date, string | no |
| type | string | no |
| description | string | sí |
| images | array<string>, array | sí |
| tags | array<string> | sí |
| githubUrl | string | sí |
| demoUrl | string | sí |
| technologies | array | sí |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "695aa490d3feefc41a771e52",
  "title": "Chiloé: El despertar de una pasión fotográfica",
  "slug": "chiloe-despertar-pasion-fotografica",
  "excerpt": "Un viaje a la isla mágica que transformó mi forma de ver el mundo a través del lente.",
  "status": "published",
  "mainImage": "https://assets.javiersabando.lat/blog/images/250100_chiloe/P1120847.jpg",
  "content": [
    {
      "type": "text",
      "order": 1,
      "value": "En enero del 2025, emprendí un viaje hacia el sur de Chile, específicamente al archipiélago de Chiloé. Lo que comenzó como unas vacaciones para desconectar, terminó convirtiéndose en el punto de partida de una nueva obsesión: la fotografía."
    },
    {
      "type": "image",
      "order": 2,
      "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/P1110253.jpg",
      "caption": "Un cisne de cuello negro rompe la quietud del agua, primer encuentro con la fauna que define el ritmo calmo de Chiloé."
    },
    {
      "type": "text",
      "order": 3,
      "value": "La luz en Chiloé tiene una cualidad especial. Los días nublados actúan como un difusor natural gigante, suavizando las sombras y saturando los colores de los palafitos y las iglesias de madera. Fue aquí donde empecé a entender realmente cómo la luz afecta una imagen."
    },
    {
      "type": "image",
      "order": 4,
      "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/P1110782.jpg",
      "caption": "El Una lancha avanza sobre el mar calmo mientras su tripulante navega en silencio, supongo que la experiencia lo lleva contantemente al estado de flow."
    },
    {
      "type": "text",
      "order": 5,
      "value": "Caminar por los muelles y senderos con la cámara en mano me obligó a observar con más detención. Ya no solo miraba el paisaje, sino que buscaba composiciones, líneas guía y momentos únicos. Cada foto que tomaba era un intento de capturar no solo lo que veía, sino lo que sentía en ese momento, una calma que se sentía en cada paso."
    },
    {
      "type": "text",
      "order": 6,
      "value": "A continuación, comparto una selección de las imágenes que marcaron este viaje y este comienzo."
    },
    {
      "type": "slide",
      "order": 7,
      "slides": [
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/P1120862.jpg",
          "caption": "La línea donde tierra y mar se confunden, un paisaje que invita a detenerse antes de disparar."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090438.jpg",
          "caption": ""
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090500.jpg",
          "caption": ""
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090506.jpg",
          "caption": "Un ave permanece inmóvil entre rocas cubiertas de algas, en equilibrio constante entre tierra y agua, leyendo el entorno antes de dar el siguiente paso."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090563.jpg",
          "caption": "Desde el muelle, el paisaje se ordena en capas: agua, cielo y estructuras que resisten al clima."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090696.jpg",
          "caption": "Dos bailarines se enfrentan en plena danza, donde cada gesto, pañuelo y mirada sostiene una tradición que se transmite más por el cuerpo que por las palabras."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090701.jpg",
          "caption": "La danza se despliega sobre el escenario con energía contenida, transformando el espacio en un punto de encuentro entre identidad, ritmo y memoria colectiva."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090711.jpg",
          "caption": "Reflejos suaves que duplican el paisaje y refuerzan la calma del momento."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090776.jpg",
          "caption": "Un grupo de pingüinos asciende por la roca como si siguiera una coreografía aprendida de memoria, repitiendo un ritual que ocurre mucho antes de que alguien llegue con una cámara."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1090812.jpg",
          "caption": ""
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1100115.jpg",
          "caption": ""
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1100179.jpg",
          "caption": "Suspendido sobre el bosque, el columpio ofrece una pausa improbable: un momento de vértigo y silencio donde la vista se pierde y el tiempo afloja."
        },
        {
          "imageUrl": "https://assets.javiersabando.lat/blog/images/250100_chiloe/_1100293.jpg",
          "caption": ""
        }
      ]
    }
  ],
  "publishedAt": "2026-01-03T12:00:00.000Z",
  "createdAt": "2026-01-04T00:00:00.000Z",
  "updatedAt": "2026-01-04T00:00:00.000Z",
  "type": "blog"
}
```
</details>

## sessions

Muestreados: 0 documentos

_Colección vacía._

## repos

Muestreados: 3 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| title | string | no |
| slug | string | no |
| description | string | no |
| content | array<object> | no |
| images | array<string> | no |
| githubUrl | string | no |
| demoUrl | string | sí |
| technologies | array<string> | no |
| status | string | no |
| __v | number | no |
| createdAt | Date | no |
| updatedAt | Date | no |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "69267097d5ea749d9d2cd17d",
  "title": "Portfolio Website",
  "slug": "portfolio-website",
  "description": "A modern portfolio website built with Nuxt 3, featuring a blog and project showcase.",
  "content": [
    {
      "type": "text",
      "order": 0,
      "value": "<p>A comprehensive portfolio showcasing modern web development practices.</p>",
      "_id": "69267097d5ea749d9d2cd17e"
    }
  ],
  "images": [
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=450&fit=crop"
  ],
  "githubUrl": "https://github.com/example/portfolio",
  "demoUrl": "https://example.com",
  "technologies": [
    "Vue 3",
    "Nuxt 3",
    "MongoDB",
    "TypeScript",
    "Tailwind CSS"
  ],
  "status": "published",
  "__v": 0,
  "createdAt": "2025-11-26T03:14:31.401Z",
  "updatedAt": "2025-11-26T03:14:31.401Z"
}
```
</details>

## bloglikes

Muestreados: 0 documentos

_Colección vacía._

## tags

Muestreados: 1 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| name | string | no |
| parent | null | no |
| __v | number | no |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "6878675dc0d1ec7d4ae5eb1e",
  "name": "Paisaje",
  "parent": null,
  "__v": 0
}
```
</details>

## images

Muestreados: 25 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| url | string | no |
| file | string | no |
| categories | array<string> | no |
| category | string | no |
| caption | string | no |
| footer | string | no |
| footer_en | string | no |
| stars | number | no |
| portfolio | boolean | no |
| visible | boolean | no |
| focal | string | no |
| apertura | number | no |
| iso | number | no |
| velocidad | string | no |
| camera | string | no |
| lens | string | no |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "69718ce04050dc7d054a4e23",
  "url": "https://assets.javiersabando.lat/blog/images/250100_chiloe/P1120847.jpg",
  "file": "P1120847.jpg",
  "categories": [
    "marítimo",
    "barco",
    "paisaje",
    "transporte"
  ],
  "category": "marítimo",
  "caption": "La imagen muestra un barco de pasajeros en navegación sobre un cuerpo de agua amplio y tranquilo. Al fondo se observa una línea costera con vegetación y algunas construcciones dispersas. El cielo tiene una cobertura parcial de nubes y el barco está en dirección hacia el frente manteniendo un desplazamiento estable.",
  "footer": "Barco de pasajeros navegando sobre aguas tranquilas cerca de la costa.",
  "footer_en": "Passenger boat sailing on calm waters near the coast.",
  "stars": 0,
  "portfolio": false,
  "visible": true,
  "focal": "27 mm",
  "apertura": 8,
  "iso": 100,
  "velocidad": "1/250",
  "camera": "Panasonic DMC-FZ300",
  "lens": "N/A"
}
```
</details>

## metrics

Muestreados: 1 documentos

| Campo | Tipo(s) | Opcional |
|---|---|---|
| _id | ObjectId | no |
| hello | string | no |

<details><summary>Ejemplo</summary>

```json
{
  "_id": "6848ed0c0bb0b0fb09fea369",
  "hello": "world"
}
```
</details>

