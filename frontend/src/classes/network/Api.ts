'use strict';

import {
    Emitter,
    ApiRequest,
    TApiRequestMethod,
    IApiRequestParameters,
    ApiRequestsManager,
    ClientLocation
} from '@src/classes';

export interface IApiAccountData {
    id: number,
    rights: string[],
    [key: string]: any
}

/**
 * Classe `Api`
 *
 * Fournit une interface unifiée entre le frontend et le backend.
 * 
 * Cette classe encapsule la logique de communication HTTP avec l’API, la gestion
 * des requêtes (`GET`, `POST`, etc.), ainsi que l’état d’authentification utilisateur.
 * 
 * `Api` étend `Emitter`, ce qui permet d’écouter des événements comme :
 * - `connected` : lorsque l’utilisateur est authentifié ;
 * - `not-connected` : lorsque l’authentification échoue ou le token est absent.
 * 
 * @example
 * ```typescript
 * await Api.post('/categories', { name: 'New Category' });
 * const categories = await Api.get('/categories');
 * console.log(categories);
 * ```
 */

export class Api extends Emitter {

    /**
     * Données du compte utilisateur authentifié.
     * Contient notamment :
     * - `id` : identifiant de l’utilisateur,
     * - `rights` : liste des droits (`string[]`),
     * - ainsi que d’éventuelles propriétés supplémentaires.
     */
    public accountData: IApiAccountData | null = null;

    /**
     * Initialise une nouvelle instance de l’API.
     * 
     * En pratique, cette classe est souvent utilisée uniquement via ses méthodes statiques.
     */
    constructor() {

        super();
    }

    /**
     * Retourne l’URL de base utilisée pour les requêtes API.
     *
     * Elle est construite à partir de l’adresse actuelle du site
     * (protocole + hostname) et du chemin racine retourné par `ClientLocation`.
     *
     * @returns {URL} L’URL de base vers l’API (ex : `https://example.com/api`).
     *
     * @example
     * ```typescript
     * const base = Api.getBaseURL();
     * console.log(base.href); // "https://localhost/api"
     * ```
     */
    static getBaseURL() : URL {

        return new URL(`${location.protocol}//${location.host}${ClientLocation.get().rootPath}/api`);
    }

    /**
     * Envoie une requête HTTP générique vers le backend.
     *
     * Cette méthode est utilisée en interne par `get()`, `post()` et `getBinary()`.
     * Elle gère la création d’un objet `ApiRequest`, son envoi via `ApiRequestsManager`,
     * et le branchement sur les événements `success` et `error`.
     *
     * @param {TApiRequestMethod} method - Méthode HTTP à utiliser (`GET`, `POST`, `PUT`, `DELETE`, ...).
     * @param {string} endpoint - Endpoint relatif à l’API (ex : `/categories`).
     * @param {IApiRequestParameters} [parameters={}] - Paramètres de la requête (body, query, headers...).
     * @param {boolean} [binary=false] - Indique si la réponse attendue est binaire (fichiers, blobs...).
     * 
     * @returns {Promise<any>} Promesse résolue avec la réponse du backend.
     *
     * @example
     * ```typescript
     * const data = await Api.request('POST', '/users', { name: 'Alice' });
     * ```
     *
     * @throws {Error} Si la requête échoue (erreur réseau ou réponse non valide).
     */
    static request(method: TApiRequestMethod, endpoint: string, parameters: IApiRequestParameters = {}, binary: boolean = false) : Promise<any> {

        return new Promise((resolve, reject) => {

            const request = new ApiRequest({
                method: method,
                endpoint: endpoint,
                parameters: parameters,
                binary: binary
            });

            request.on('success', resolve);
            request.on('error', reject);
            
            ApiRequestsManager.send(request);
        });
    }

    /**
     * Effectue une requête HTTP GET classique.
     *
     * @param {string} endpoint - Endpoint de l’API.
     * @param {IApiRequestParameters} [parameters={}] - Paramètres optionnels.
     * @returns {Promise<any>} Réponse du serveur.
     *
     * @example
     * ```typescript
     * const users = await Api.get('/users');
     * ```
     */
    static get(endpoint: string, parameters: IApiRequestParameters = {}) : Promise<any> {

        return Api.request('GET', endpoint, parameters);
    }

    /**
     * Effectue une requête HTTP POST.
     *
     * @param {string} endpoint - Endpoint de l’API.
     * @param {IApiRequestParameters} [parameters={}] - Corps de la requête (souvent JSON).
     * @returns {Promise<any>} Réponse du serveur.
     *
     * @example
     * ```typescript
     * await Api.post('/login', { username: 'admin', password: '1234' });
     * ```
     */
    static post(endpoint: string, parameters: IApiRequestParameters = {}) : Promise<any> {

        return Api.request('POST', endpoint, parameters);
    }

    /**
     * Effectue une requête GET et récupère une réponse binaire (Blob, ArrayBuffer, etc.).
     *
     * @param {string} endpoint - Endpoint de l’API.
     * @param {IApiRequestParameters} [parameters={}] - Paramètres optionnels.
     * @returns {Promise<any>} Données binaires reçues du serveur.
     *
     * @example
     * ```typescript
     * const image = await Api.getBinary('/images/logo.png');
     * ```
     */
    static getBinary(endpoint: string, parameters: IApiRequestParameters = {}) : Promise<any> {

        return Api.request('GET', endpoint, parameters, true);
    }

    /**
     * Vérifie l’état d’authentification actuel de l’utilisateur.
     *
     * Cette méthode tente de valider le token stocké dans `localStorage`.
     * Si le token est valide, les données du compte sont récupérées via `/me`
     * et stockées dans `this.accountData`.
     *
     * Elle émet :
     * - `connected` : lorsque la vérification réussit ;
     * - `not-connected` : lorsque le token est absent ou invalide.
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```typescript
     * const api = new Api();
     * api.on('connected', () => console.log('Utilisateur connecté'));
     * api.on('not-connected', () => console.log('Pas de session active'));
     * await api.checkAuth();
     * ```
     */
    public async checkAuth() : Promise<void> {

        try {

            this.accountData = await Api.get('/me');

            console.info(`[Logged in]`);

            this.emit('connected');

        } catch(error) {

            console.warn('[Failed authentication check]', error);

            this.accountData = null;
            this.emit('not-connected');
        }
    }

    /**
     * Supprime les informations d’authentification stockées localement.
     *
     * Cette méthode efface le token JWT (ou équivalent) du `localStorage`.
     *
     * @example
     * ```typescript
     * Api.clearAuth();
     * console.log("Utilisateur déconnecté");
     * ```
     */
    static clearAuth() : void {

        return localStorage.removeItem(ApiRequest.LOCAL_STORAGE_TOKEN_NAME);
    }
}