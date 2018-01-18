// server.js
// where your node app starts

// init project
var rp = require('request-promise');
var Bluebird = require('bluebird');
var Sequelize = require('sequelize');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

var trello = path => {return `https://api.trello.com/1/${path}?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`;}

// DB setup
var Sequelize = require('sequelize');
var Diffs, Users, Boards;
var sequelize = new Sequelize(process.env.DB, process.env.DB_USER, process.env.DB_PASS, {
  host: '0.0.0.0',
  dialect: 'postgres',
  pool: {
    max: 5,
    min: 0,
    idle: 10000
  },
  logging: false
});
// authenticate with the database
sequelize.authenticate()
  .then(function(err) {
    Diffs = sequelize.define('diffs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true
      },
      cards: {
        type: Sequelize.STRING
      }
    });
    Users = sequelize.define('users', {
        name: {
            type: Sequelize.TEXT,
            primaryKey: true
        },
        trello: {
            type: Sequelize.TEXT,
            unique: true
        },
        slack: {
            type: Sequelize.TEXT,
            unique: true
        },
        phab: {
            type: Sequelize.TEXT,
            unique: true
        }
    });
    Boards = sequelize.define('boards', {
        id: {
            type: Sequelize.TEXT,
            primaryKey: true
        },
        name: {type: Sequelize.TEXT},
        emoji: {type: Sequelize.TEXT}
    });
  })
  .catch(function (err) {
    console.log('Unable to connect to the database: ', err);
  });

// This is the webhook that phabricator posts to when new notifications are created.
app.all("/", function (req, res) {
    if (req.body.storyText) {
        // Decode the storyText variable.  It looks like this:
        // nate removed a reviewer for D27336: Gemini list update: Ads.
        // [user] [action]D[diff_id]: [Diff description]
        var storyTextRegex = /([\w-]+)\s+(.+?)\bD(\d+):\s*(.+)/
        var storyData = req.body.storyText.match(storyTextRegex);
        if (storyData) {
            console.log(storyData[0]);
            // this is a diff, pull/create its record from the DB
            getDiffCardsFromDB(req, res, storyData)
        }
    }
});

// This is the webhook that trello posts to when new activities are generated.
app.all('/t/', (req, res) => {
  var diffRegex = /(D[0-9])\w+/g;
  var trelloRegex = /(trello.com\/c\/[a-zA-Z0-9])\w+/g;
  if (req.body.action && req.body.action.type === 'commentCard') {
    var comment = req.body.action.data.text;
    var cardId = req.body.action.data.card.shortLink;
    var matches = comment.match(diffRegex);
    if (matches) {
      // array of diffs mentioned in trello comment
      var diffArray = [];
      matches.forEach(diff => {
        diffArray.push(parseInt(diff.substr(1)));
      });
      var options = {
        uri: process.env.PHAB_URL + '/api/differential.query',
        qs: {
            "api.token": process.env.PHAB_TOKEN,
            "ids": diffArray,
        }
      };
      rp(options)
      .then(diffData => {
        // array of diff (summaries)
        var requests = [];
        diffData = JSON.parse(diffData);
        diffData.result.forEach(diff => {
            // check for cards in the diff summary
            var cardsInDiff = diff.summary.match(trelloRegex);
            if (!cardsInDiff || cardsInDiff.indexOf(cardId) === -1) {
                //no cards in diff or this card doesnt exist, add
                var options = {
                    uri: process.env.PHAB_URL + '/api/differential.revision.edit',
                    qs: {
                        "api.token": process.env.PHAB_TOKEN,
                        "transactions": [{
                            type: "summary",
                            value: `${diff.summary}\nhttps://trello.com/c/${cardId}/`
                        }],
                        "objectIdentifier": diff.id
                    }
                };
                requests.push(rp(options));
            }
        });
        if (requests.length > 0) {
            Promise.all(requests)
            .then(requestsResponses => {
                console.log(requestsResponses);
                res.sendStatus(200);
            })
        } else {
            res.sendStatus(200);
        }
      })
    }
  } else {
    res.sendStatus(200);
  }
});

const getDiffCardsFromDB = (req, res, diffmsg) => {
    var diffid = diffmsg[3];
    Diffs.sync() // using 'force' it drops the table users if it already exists, and creates a new one
    .then(function(){
      Diffs.findOne({where: {id: diffid}})
        .then(diff => {
          if (!diff) {
            // create diff in db
            Diffs.create({ id: diffid, cards: JSON.stringify([])})
              .then(()=> {
                Diffs.findOne({where: {id: diffid}})
                  .then(diff => {
                    parseTrelloUrls(req, res, diff);
                  });
              });
          } else {
            parseTrelloUrls(req, res, diff);
          }
      })
    });
}

var parseTrelloUrls = (req, res, diff) => {
    var ids = [];
    ids.push(diff.id);
    var getCommitMessageRequest = {
        uri: process.env.PHAB_URL + '/api/differential.query',
        qs: {
            "api.token": process.env.PHAB_TOKEN,
            "ids": ids
        }
    }
    rp(getCommitMessageRequest)
        .then(phabRes => {
            phabRes = JSON.parse(phabRes);
            var getRepoInfo = {
                uri: process.env.PHAB_URL + '/api/diffusion.repository.search',
                qs: {
                    "api.token": process.env.PHAB_TOKEN,
                    "constraints": {
                        "phids": [
                            phabRes.result["0"].repositoryPHID
                        ]
                    }
                }
            };
            rp(getRepoInfo)
                .then(phabRes2 => {
                    phabRes2 = JSON.parse(phabRes2);
                    console.log(phabRes2);
                    phabRes.result["0"].repositoryName = phabRes2.result.data[0] && phabRes2.result.data[0].fields ? phabRes2.result.data[0].fields.callsign : 'UNKNOWN';
                    compareDBtoPhab(req, res, diff, phabRes);
                })
        });
};

var compareDBtoPhab = (req, res, diff, phabRes) => {
    var regex = /trello.com\/c\/(........)/g;
    var cardsInDB = JSON.parse(diff.cards);
    var cardsInPhab = [];
    var parseResults = false;
    if (phabRes.result["0"].summary) {
        parseResults = phabRes.result["0"].summary.match(regex);
    }
    if (parseResults) {
        parseResults.forEach(match => {
            var card = match.substr(13);
            cardsInPhab.push(card);
        });
    }
    var updates = [];
    if (cardsInPhab.length === 0) {
        if (cardsInDB.length > 0) {
            // there arent any cards in phab but there are in the DB/trello so let's remove them
            cardsInDB.forEach(card => {updates.push({card: card, action: 'delete'})});
        }
    } else {
        // cardsLeftOver = cards in the DB but not in Phab - delete these
        var cardsLeftOver = cardsInDB.filter(card => {
            return cardsInPhab.indexOf(card) === -1;
        });
        cardsInPhab.forEach(phabCard => {
            if (cardsLeftOver.indexOf(phabCard) === -1)
                updates.push({card: phabCard, action: 'upsert'});
        });
        cardsInDB.forEach(dbCard => {
            if (cardsLeftOver.indexOf(dbCard) > -1)
                updates.push({card: dbCard, action: 'delete'});
        });
    }
    if (updates) {
        // there's either creates, deletes, or updates - process them
        createURLData(req, res, phabRes, updates);
    } else {
        // no updates, nothing to do here
        res.sendStatus(200);
    }
};

var createURLData = (req, res, phabRes, updates) => {
    // parse title, status and reviewers
    var data = {};
    data.id = phabRes.result["0"].id;
    data.title = phabRes.result["0"].title;
    data.status = phabRes.result["0"].statusName;
    data.repo = phabRes.result["0"].repositoryName;
    if (phabRes.result["0"].reviewers) {
        // map phab users to trello users and add to data.reviewers
        data.reviewers = [];
        var userList = [];
        Object.keys(phabRes.result["0"].reviewers).forEach(phabid => {
            console.log(phabid);
            userList.push(Users.findOne({where: {phab: phabid}}));
        });
        Users.sync()
        .then(function(){
            Promise.all(userList)
            .then(dbUsers => {
                console.log(dbUsers);
                dbUsers.forEach(dbUser => {
                    if (dbUser)
                        data.reviewers.push(dbUser.trello);
                });
                updateTrello(req, res, updates, data);
            });
        });
    }

}

var updateTrello = (req, res, updates, urlData) => {
    // updates: all the trello cards that needs updates and type of update
    // urlData = diff data object from phab
    var cardDataRequests = [];
    // get card data
    updates.forEach(update => {
        var request = {
            uri: `https://api.trello.com/1/cards/${update.card}`,
            qs: {
                key: process.env.TRELLO_KEY,
                token: process.env.TRELLO_TOKEN,
                fields: 'desc',
                attachments: true
            }
        }
        cardDataRequests.push(rp(request));
    });
    Promise.all(cardDataRequests)
        .then(cardData => {
            var cardUpdateRequests = [];
            updates.forEach((update, idx) => {
                // for each update card, look at it's attachments
                // checking for one that has a url matching our current diff id
                var matchingAttachment = false;
                var thisCard = JSON.parse(cardData[idx]);
                if (thisCard.attachments.length > 0) {
                    thisCard.attachments.forEach(attachment => {
                        var diffUrl = `${process.env.PHAB_URL}/D${urlData.id}`;
                        if (attachment.url.indexOf(diffUrl) > -1) {
                            matchingAttachment = attachment;
                        }
                    });
                }
                if (matchingAttachment && update.action == 'delete') {
                    // delete attachment
                    var request = {
                        uri: `https://api.trello.com/1/cards/${update.card}/attachments/${matchingAttachment.id}`,
                        qs: {
                            key: process.env.TRELLO_KEY,
                            token: process.env.TRELLO_TOKEN
                        },
                        method: 'DELETE'
                    };
                    cardUpdateRequests.push(rp(request));
                }
                if (!matchingAttachment && update.action == 'upsert') {
                    // add attachment
                    var request = {
                        uri: `https://api.trello.com/1/cards/${update.card}/attachments`,
                        qs: {
                            key: process.env.TRELLO_KEY,
                            token: process.env.TRELLO_TOKEN
                        },
                        method: 'POST',
                        body: {
                            name: `D${urlData.id}: ${urlData.title}`,
                            url: `${process.env.PHAB_URL}/D${urlData.id}`
                        },
                        json: true
                    };
                    // Add deletion request to array
                    cardUpdateRequests.push(rp(request));
                }
                // for each update card, break up the description into chunks based on the diffs linked within - we'll edit this and then repost it at the end
                var descriptionRegex = /\[D(\d+)(.*?\?trello_data=)([^\)]*)/g;
                var match;
                var lastIndex = 0;
                var descArray = [];
                while ((match = descriptionRegex.exec(thisCard.desc)) !== null) {
                  descArray.push(
                    thisCard.desc.substr(lastIndex, match.index - lastIndex),
                    '[D',
                    match[1],
                    match[2],
                    match[3],
                    ')'
                  );
                  lastIndex = match.index + match[0].length + 1;
                }
                if (descArray.length == 0) {
                  descArray.push(thisCard.desc);
                } else {
                  descArray.push(thisCard.desc.substr(lastIndex));
                }
                var updatedDesc = descArray.slice(0);
                var descIndex = updatedDesc.length > 0 && updatedDesc.indexOf(urlData.id);
                if (descIndex && descIndex > -1) {
                    if (update.action == 'upsert') {
                        // link already exists, update data in array
                        updatedDesc[descIndex + 2] = encodeURIComponent(JSON.stringify(urlData));
                    } else {
                        // link exists, delete values from arrays
                        updatedDesc.splice(descIndex - 1, 5);
                    }
                } else {
                    if (update.action == 'upsert') {
                        // add link to end of description array
                        var url = `${process.env.PHAB_URL}/D${urlData.id}?trello_data=${encodeURIComponent(JSON.stringify(urlData))}`;
                        // look for 'Linked Diffs:' in the description text;
                        var insertItem, insertPoint
                        if (updatedDesc) {
                            updatedDesc.forEach((descItem, updatedDescIdx) => {
                                var idx = descItem.indexOf('Linked Diffs:');
                                if (idx > -1) {
                                    insertItem = updatedDescIdx;
                                    insertPoint = idx + 14;
                                }
                            });
                        }
                        if (insertPoint) {
                            // we found the linked diffs line, add the link
                            updatedDesc[insertItem] = [
                                updatedDesc[insertItem].slice(0,insertPoint),
                                ` [D${urlData.id}](${url})`,
                                updatedDesc[insertItem].slice(insertPoint)
                            ].join('')
                        } else {
                            // linked diffs line doesnt exist, create one
                            updatedDesc.push(`\nLinked Diffs: [D${urlData.id}](${url})`);
                        }
                    }
                }
                // compare the arrays to see if anything changed
                console.log('descArray: ', descArray);
                console.log('updatedDesc: ', updatedDesc);
                if (JSON.stringify(descArray) !== JSON.stringify(updatedDesc)) {
                    // update description
                    var request = {
                        uri: `https://api.trello.com/1/cards/${update.card}/desc`,
                        qs: {
                            key: process.env.TRELLO_KEY,
                            token: process.env.TRELLO_TOKEN,
                            value: updatedDesc.join('')
                        },
                        method: 'PUT',
                        json: true
                    };
                    cardUpdateRequests.push(rp(request));
                }
            });
            if (cardUpdateRequests.length > 0) {
                Promise.all(cardUpdateRequests)
                    .then(updateResponses => {
                        // done, update the DB too
                        updateDB(req, res, updates, urlData);
                    });
            } else {
                // no updates, we're done
                res.sendStatus(200);
            }
        });

}

var updateDB = (req, res, updates, urlData) => {
        Diffs.findOne({where: {id: urlData.id}})
        .then(diff => {
            var cards = diff.dataValues ? JSON.parse(diff.dataValues.cards) : false;
            if (!cards) {
                var newCardsArray = updates.filter(update => {return update.action == 'upsert'});
                // no record exists, just add the upserts
                Diffs.create(
                    { id: urlData.id, cards: JSON.stringify(newCardsArray)}
                ).then(() => {
                    res.sendStatus(200);
                });
            } else {
                // record exists, process both upserts and deletes
                var newCardsArray = cards.slice(0);
                updates.forEach(update => {
                    if (update.action === 'upsert' && newCardsArray.indexOf(update.card) === -1)
                        newCardsArray.push(update.card);
                    else if (update.action === 'delete' && newCardsArray.indexOf(update.card) > -1)
                        newCardsArray.splice(newCardsArray.indexOf(update.card),1);
                });
                if (JSON.stringify(newCardsArray) != JSON.stringify(cards)) {
                    Diffs.update(
                      {cards: JSON.stringify(newCardsArray)},
                      {where: {id: urlData.id}}
                    ).then(() => {
                        res.sendStatus(200);
                    });
                } else {
                    res.sendStatus(200);
                }
            }
        });
}

// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
    console.log('Your app is listening on port ' + listener.address().port);
});
