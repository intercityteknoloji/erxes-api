import * as graph from 'fbgraph';
import { Accounts } from '../db/models';
import { IFbUser } from '../db/models/definitions/conversationMessages';
import { receiveWebhookResponse } from './facebook';

/*
 * Common graph api request wrapper
 * catchs auth token or other type of exceptions
 */
export const graphRequest = {
  base(method: string, path?: any, accessToken?: any, ...otherParams) {
    // set access token
    graph.setAccessToken(accessToken);
    graph.setVersion('3.2');

    return new Promise((resolve, reject) => {
      graph[method](path, ...otherParams, (error, response) => {
        if (error) {
          console.log('error', error);
          return reject(error);
        }

        return resolve(response);
      });
    });
  },

  get(...args): any {
    return this.base('get', ...args);
  },

  post(...args): any {
    return this.base('post', ...args);
  },
};

/*
 * Listen for facebook webhook response
 */
export const trackIntegrations = expressApp => {
  const { FACEBOOK_APP_ID } = process.env;

  expressApp.get(`/service/facebook/${FACEBOOK_APP_ID}/webhook-callback`, (req, res) => {
    const query = req.query;

    // when the endpoint is registered as a webhook, it must echo back
    // the 'hub.challenge' value it receives in the query arguments
    if (query['hub.mode'] === 'subscribe' && query['hub.challenge']) {
      if (query['hub.verify_token'] !== FACEBOOK_APP_ID) {
        res.end('Verification token mismatch');
      }

      res.end(query['hub.challenge']);
    }
  });

  expressApp.post(`/service/facebook/${FACEBOOK_APP_ID}/webhook-callback`, (req, res) => {
    res.statusCode = 200;

    // receive per app webhook response
    receiveWebhookResponse(req.body);

    res.end('success');
  });
};

export const trackFbLogin = expressApp => {
  expressApp.get('/fblogin', (req, res) => {
    const { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, DOMAIN, MAIN_APP_DOMAIN, FACEBOOK_PERMISSIONS } = process.env;

    const conf = {
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      scope: FACEBOOK_PERMISSIONS || 'manage_pages, pages_show_list, pages_messaging',
      redirect_uri: `${DOMAIN}/fblogin`,
    };

    // we don't have a code yet
    // so we'll redirect to the oauth dialog
    if (!req.query.code) {
      const authUrl = graph.getOauthUrl({
        client_id: conf.client_id,
        redirect_uri: conf.redirect_uri,
        scope: conf.scope,
      });

      if (!req.query.error) {
        // checks whether a user denied the app facebook login/permissions
        res.redirect(authUrl);
      } else {
        // req.query.error == 'access_denied'
        res.send('access denied');
      }
    }

    // If this branch executes user is already being redirected back with
    // code (whatever that is)
    // code is set
    // we'll send that and get the access token
    return graph.authorize(
      {
        client_id: conf.client_id,
        redirect_uri: conf.redirect_uri,
        client_secret: conf.client_secret,
        code: req.query.code,
      },
      async (_err, facebookRes) => {
        const { access_token } = facebookRes;

        const userAccount: {
          id: string;
          first_name: string;
          last_name: string;
        } = await graphRequest.get('me?fields=id,first_name,last_name', access_token);

        const name = `${userAccount.first_name} ${userAccount.last_name}`;

        await Accounts.createAccount({
          token: access_token,
          name,
          kind: 'facebook',
          uid: userAccount.id,
        });

        return res.redirect(`${MAIN_APP_DOMAIN}/settings/integrations?fbAuthorized=true`);
      },
    );
  });
};

export interface IComment {
  id: string;
  parent?: { id: string };
  from: IFbUser;
  message?: string;
  attachment_url?: string;
  attachment?: any;
  can_comment: boolean;
  comment_count: number;
  created_time: string;
  comments: IComments;
}

export interface IComments {
  data: IComment[];
  paging: any;
  summary: {
    order: string;
    total_count: number;
    can_comment: boolean;
  };
}

export interface IPost {
  caption?: string;
  id: string;
  description?: string;
  link?: string;
  picture?: string;
  source?: string;
  message?: string;
  from: IFbUser;
  comments?: IComments;
}

/*
 * Find post comments using postId
 */
export const findPostComments = async (accessToken: string, postId: string, comments: IComment[]) => {
  const postComments: IComments = await graphRequest.get(
    `/${postId}/comments?fields=parent.fields(id),from,message,attachment_url&limit=3000`,
    accessToken,
  );

  const { data } = postComments;

  for (const comment of data) {
    comments.push(comment);

    await findPostComments(accessToken, comment.id, comments);
  }

  return comments;
};

export const getPageInfo = async (
  pageId: string,
  userAccessToken: string,
): Promise<{ access_token: string; id: string }> => {
  return graphRequest.get(`${pageId}?fields=id,access_token`, userAccessToken);
};

export const subscribePage = async (pageId, pageToken): Promise<{ success: true } | any> => {
  return graphRequest.post(`${pageId}/subscribed_apps`, pageToken, {
    subscribed_fields: ['conversations', 'messages', 'feed'],
  });
};

export const getCommentInfo = async ({ commentId, token }: { commentId: string; token: string }): Promise<IComment> => {
  return graphRequest.get(
    `/${commentId}?fields=parent.fields(id),id,from,message,can_comment,attachment,comment_count,created_time,comments.summary(true)`,
    token,
  );
};

export const getPostInfo = async ({ postId, token }: { postId: string; token: string }): Promise<IPost> => {
  return graphRequest.get(
    `/${postId}?fields=id,caption,description,link,picture,source,message,from,comments.summary(true),created_time`,
    token,
  );
};

export const getComments = async ({ commentId, token }: { commentId: string; token: string }): Promise<IComments> => {
  return graphRequest.get(
    `/${commentId}/comments?fields=parent.fields(id),id,created_time,from,message&limit=1000`,
    token,
  );
};

export const fetchComments = async ({ postId, token, limit }: { postId: string; token: string; limit: number }) => {
  return graphRequest.get(`/${postId}/comments?order=reverse_chronological&limit=${limit || 5}`, token);
};
