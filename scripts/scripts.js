/*jshint bitwise:false, debug:true */
/*global _:true, bean:true, Box2D:true, gapi:true */
/* SHARED STATE:
 * gameState - Global state of the game (these are propagated):
 *             0 - no game is started
 *             1 - game is currently played
 *             2 - game has finished
 * score|ID  - Score for individual players
 * lastScore - Timestamp of last scoring
 */

/* LOCAL STATE:
 * gameState - Local game state:
 *             0 - same as Global
 *             1 - same as Global
 *             2 - same as Global
 *             3 - game was lost locally (ball lost), needs to wait until the end
 *             4 - late join to the game, needs to wait until the end
 */
var rotate;
var speedFactor = 50;
//<- factor of gravity to negate on impulse. Being multiplied by mass.
//in ball create method, friction, restitution and mass make for good fun.
var bounce;
//bounce audio.
var fanSong;
window.init = function() {"use strict";

	window.requestAnimationFrame = (function(undefined) {
		return window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame ||
		function shimRequestAnimationFrame(callback) {
			window.setTimeout(function() {
				callback((new Date()).getTime());
			}, 1000 / 60);
		};
	})();

	var//baseUrl = document.getElementsByTagName('base').length ? document.getElementsByTagName('base')[0].href : '',
	baseUrl = 'http://dev.welikepie.com/fffDev/', game = ( function(undefined) {

			/* EVENTS:
			 * onGameStart   - fired when the game starts
			 * onGameEnd     - fired when the game ends
			 * onGameLost    - fired when the user loses the ball
			 * onLateJoin    - fired for users joining the game late
			 *
			 * onPointScored - fired when someone scores
			 * onPlayerDrop  - fired when a player decides to drop
			 */

			var localState = 0, localScores = {}, result = {

				'state' : {

					'get' : function getState() {
						return localState;
					},
					'set' : function setState(state) {
						state = parseInt(state, 10);
						if (localState !== state) {
							localState = state;
							bodyTag.className = 'state-' + localState;
							switch (localState) {
								case result.state.PLAYING:
									bean.fire(result, 'onGameStart');
									break;
								case result.state.ENDED:
									bean.fire(result, 'onGameEnd');
									break;
								case result.state.LOST:
									bean.fire(result, 'onGameLost');
									break;
								case result.state.LATEJOIN:
									bean.fire(result, 'onLateJoin');
									break;
							}
						}
					},

					'IDLE' : 0,
					'PLAYING' : 1,
					'ENDED' : 2,
					'LOST' : 3,
					'LATEJOIN' : 4

				},
				'localScore' : 0,
				'scores' : {

					'get' : function getScores() {
						return _.clone(localScores);
					},
					'set' : function setScores(scores) {
						_.extend(localScores, _.chain(scores).pairs().map(function(item) {
							return [item[0].replace(/^score\|/i, ''), parseInt(item[1], 10)];
						}).object().value());
					},

					'init' : function initScores(players) {
						result.scores.reset();
						_.each(players, function(player) {
							localScores[player] = 0;
						});
					},

					'reset' : function resetScores() {
						var x;
						for (x in localScores) {
							if (_.has(localScores, x)) {
								delete localScores[x];
							}
						}
					},

					'remove' : function removeScore(player) {
						if (_.has(localScores, player)) {
							delete localScores[player];
						}
					}
				},

				'lastScore' : 0

			};

			return result;

		}()), lastSharedState = {}, bodyTag = document.getElementsByTagName('body')[0], filterPlayers = function filterPlayer(players) {
		return _.filter(players, function(player) {
			return player.hasAppEnabled && player.hasCamera;
		});
	}, physics = {
		'world' : null,
		'head_tracker' : null,
		'ball' : null,
		'track_joint' : null,
		'track_joint_def' : null,
		'movement_factor' : 18,
		'speedup_factor' : speedFactor,
		'velocity_mods' : [],
		'rotateInterval' : 20,
		'rotateTimer' : null,
		'bounced' : false,
		'scaling_map' : {
			0.06 : 25,
			0.09 : 20,
			0.135 : 15,
			0.2 : 10
		},
		'last_scale' : null,

		'ball_overlay' : null,
		'ball_overlay_res' : null,
		'ball_shadow' : null,
		'ball_shadow_res' : null,

		'area_width' : null,
		'area_height' : null,
		'unit_width' : null,
		'unit_height' : null,
		'rotator' : function rotator(rotateObject) {
			if (rotateObject) {
				rotateObject.setRotation(rotateObject.getRotation() + rotate);
			}
		},
		'createTracker' : function createTracker() {

			var tracker_position, tracker_velocity, tracker_angle, tracker_joint_present = false, body_def = new Box2D.Dynamics.b2BodyDef(), fixture_def = new Box2D.Dynamics.b2FixtureDef();

			// Remove current bodies from simulation, if already present
			if (physics.head_tracker) {
				tracker_position = physics.head_tracker.GetWorldCenter();
				tracker_velocity = physics.head_tracker.GetLinearVelocity();
				tracker_angle = physics.head_tracker.GetAngle();
				if (physics.track_joint) {
					tracker_joint_present = true;
					physics.world.DestroyJoint(physics.track_joint);
					physics.track_joint = null;
				}
				physics.world.DestroyBody(physics.head_tracker);
				physics.head_tracker = null;
			}

			if (physics.last_scale) {

				fixture_def.filter = new Box2D.Dynamics.b2FilterData();
				fixture_def.friction = 0.1;
				fixture_def.restitution = 1;

				// Set up and create Head Tracker
				body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
				body_def.bullet = true;
				body_def.allowSleep = false;
				body_def.fixedRotation = true;
				// Prevents the head tracker from rotation - Breakout-paddle-style
				body_def.linearDamping = 1;
				// Makes it so that the head tracker stops to halt when without tracking data

				if (tracker_position) {
					body_def.position = tracker_position;
				} else {
					body_def.position = new Vector(physics.area_width / 2, physics.area_height * 2 / 3);
				}

				if (tracker_velocity) {
					body_def.linearVelocity = tracker_velocity;
				} else {
					body_def.linearVelocity = nullVector;
				}

				if ( typeof tracker_angle !== 'undefined') {
					body_def.angle = tracker_angle;
				}

				//fixture_def.filter.categoryBits = 2;	// Category only for head tracker, only static elements should collide with it
				//fixture_def.filter.maskBits = 1;		// Ensures that the head tracker only collides with static elements
				fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
				fixture_def.shape.SetAsBox(physics.unit_width * 2.5, physics.unit_width);
				fixture_def.density = 999;

				physics.head_tracker = physics.world.CreateBody(body_def);
				physics.head_tracker.CreateFixture(fixture_def);

				if (tracker_joint_present) {
					physics.createJoint();
				}

			}

		},
		'createBall' : function createBall() {

			var ball_position, ball_velocity, body_def = new Box2D.Dynamics.b2BodyDef(), fixture_def = new Box2D.Dynamics.b2FixtureDef();

			if (physics.ball) {

				ball_position = physics.ball.GetWorldCenter();
				ball_velocity = physics.ball.GetLinearVelocity();
				physics.world.DestroyBody(physics.ball);
				physics.ball = null;

			}

			if (physics.last_scale) {

				// Set up and create the ball
				body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
				body_def.fixedRotation = false;
				body_def.linearDamping = 0;

				if (ball_position) {
					body_def.position = ball_position;
				} else {
					body_def.position = new Vector(physics.area_width / 2, physics.area_height / 6);
				}

				if (ball_velocity) {
					body_def.linearVelocity = ball_velocity;
				} else {
					body_def.linearVelocity = nullVector;
				}
				//else { body_def.linearVelocity = new Vector(0, physics.movement_factor * physics.speedup_factor); }

				fixture_def.friction = 1;
				fixture_def.restitution = 0.6;
				fixture_def.shape = new Box2D.Collision.Shapes.b2CircleShape();
				fixture_def.shape.SetRadius(physics.unit_width * 1.25);
				fixture_def.density = 10;

				physics.ball = physics.world.CreateBody(body_def);
				physics.ball.CreateFixture(fixture_def);

				// If overlay exists, adjust its size, else create new one
				if (physics.ball_overlay && physics.ball_shadow) {
					physics.ball_overlay.setScale(5 / physics.last_scale, gapi.hangout.av.effects.ScaleReference.WIDTH);
					physics.ball_shadow.setScale(5 / physics.last_scale, gapi.hangout.av.effects.ScaleReference.WIDTH);

				} else {

					if (physics.ball_overlay_res.isLoaded() && physics.ball_shadow_res.isLoaded()) {

						physics.ball_overlay = physics.ball_overlay_res.createOverlay({
							'position' : {
								'x' : (body_def.position.x / physics.area_width) - 0.5,
								'y' : (body_def.position.y / physics.area_height) - 0.5
							},
							'scale' : {
								'magnitude' : 3 / physics.last_scale,
								'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
							}
						});
						//physics.ball_overlay.setVisible(true);

						physics.ball_shadow = physics.ball_shadow_res.createOverlay({
							'position' : {
								'x' : (body_def.position.x / physics.area_width) - 0.5,
								'y' : (body_def.position.y / physics.area_height) - 0.5
							},
							'scale' : {
								'magnitude' : 3 / physics.last_scale,
								'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
							}
						});
						//physics.ball_shadow.setVisible(true);

					} else {

						physics.ball_overlay = {
							'setScale' : function() {
							},
							'setPosition' : function() {
							},
							'setVisible' : function() {
							}
						};
						physics.ball_shadow = {
							'setScale' : function() {
							},
							'setPosition' : function() {
							},
							'setVisible' : function() {
							}
						};

						physics.ball_overlay_res.onLoad.add(function() {

							var pos = physics.ball.GetWorldCenter();
							physics.ball_overlay = physics.ball_overlay_res.createOverlay({
								'position' : {
									'x' : (pos.x / physics.area_width) - 0.5,
									'y' : (pos.y / physics.area_height) - 0.5
								},
								'scale' : {
									'magnitude' : 3 / physics.last_scale,
									'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
								}
							});
							physics.ball_overlay.setVisible(true);
						});
						physics.ball_overlay_res.onLoad.add(function() {

							var pos = physics.ball.GetWorldCenter();
							physics.ball_shadow = physics.ball_shadow_res.createOverlay({
								'position' : {
									'x' : (pos.x / physics.area_width) - 0.5,
									'y' : (pos.y / physics.area_height) - 0.5
								},
								'scale' : {
									'magnitude' : 3 / physics.last_scale,
									'reference' : gapi.hangout.av.effects.ScaleReference.WIDTH
								}
							});
							physics.ball_shadow.setVisible(true);
						});

					}

				}

			}

		},
		'destroyTracker' : function destroyTracker() {
			if (physics.track_joint) {
				physics.destroyJoint();
			}
			if (physics.head_tracker) {
				physics.world.DestroyBody(physics.head_tracker);
				physics.head_tracker = null;
			}
		},
		'destroyBall' : function destroyBall() {

			if (physics.ball_overlay) {
				clearTimeout(physics.rotateTimer);
				physics.ball_overlay.dispose();
				physics.ball_overlay = null;
				physics.ball_shadow.dispose();
				physics.ball_shadow = null;
			}
			if (physics.ball) {
				clearTimeout(physics.rotateTimer);
				physics.world.DestroyBody(physics.ball);
				physics.ball = null;
			}
		},
		'createJoint' : function createJoint() {
			try {
				if (physics.track_joint) {
					physics.destroyJoint();
				}
				physics.track_joint_def.bodyA = physics.world.GetGroundBody();
				physics.track_joint_def.bodyB = physics.head_tracker;
				physics.track_joint_def.target = physics.head_tracker.GetWorldCenter();
				physics.track_joint_def.maxForce = 40000.0 * physics.head_tracker.GetMass();
				physics.track_joint = physics.world.CreateJoint(physics.track_joint_def);
			} catch (e) {
			}
		},
		'destroyJoint' : function destroyJoint() {
			if (physics.track_joint) {
				physics.world.DestroyJoint(physics.track_joint);
				physics.track_joint = null;
			}
		}
	}, Vector = Box2D.Common.Math.b2Vec2, nullVector = new Vector(0, 0), overlays = {
		'countdown' : [{
			'resource' : null,
			'overlay' : null
		}, {
			'resource' : null,
			'overlay' : null
		}, {
			'resource' : null,
			'overlay' : null
		}, {
			'resource' : null,
			'overlay' : null
		}],
		'lost' : {
			'resource' : null,
			'overlay' : null
		},
		'end' : {
			'resource' : null,
			'overlay' : null
		}
	}, tick = function tick(timestamp) {

		var ball_vel, ball_pos, should_replace = false;

		if (game.state.get() === game.state.PLAYING) {

			if (physics.ball) {
				var oldTime = 0;
				ball_pos = physics.ball.GetWorldCenter();
				ball_vel = physics.ball.GetLinearVelocity();
				if (timestamp - oldTime > 100) {
				}
				if (physics.bounced === true) {
					console.log("-----------------------");
					console.log(physics.ball.GetLinearVelocity());
					physics.ball.ApplyImpulse(new Vector(0, -20000 * physics.speedup_factor), physics.ball.GetWorldCenter());
					//console.log(new Vector(0,physics.speedup_factor*-100));
					console.log(physics.ball.GetLinearVelocity());
					console.log("-----------------------");
					physics.bounced = false;
				}

				if (physics.ball_overlay && physics.ball_shadow) {
					physics.ball_overlay.setPosition((ball_pos.x / physics.area_width) - 0.5, (ball_pos.y / physics.area_height) - 0.5);
					physics.ball_shadow.setPosition((ball_pos.x / physics.area_width) - 0.5, (ball_pos.y / physics.area_height) - 0.5);

				}

				if (ball_pos.y > physics.area_height * 1.25) {
					game.state.set(game.state.LOST);
				}
			}

			physics.world.Step(1 / 20, 5, 5);
			physics.world.DrawDebugData();
			physics.world.ClearForces();
			if (( typeof timestamp !== 'boolean') || !timestamp) {
				window.requestAnimationFrame(tick);
			}

		}

	}, initialize = function initialize() {

		/* GAME LOGIC
		 * ******************************************
		 * Bind various events coming from Hangouts API for stuff
		 * like keeping track of the game state and scores via shared state,
		 * as well as of enabled participants, to know who drops out if drop-outs
		 * do happen during the game.
		 */
		bounce = gapi.hangout.av.effects.createAudioResource(baseUrl + "audio/bounceFinal.wav");
		fanSong = gapi.hangout.av.effects.createAudioResource(baseUrl + "audio/crowdSound8.wav");
		fanSong.onLoad.add(function(ev) {
			console.log("loaded");
			console.log(ev);
			if (ev.isLoaded) {
				fanSong.play({
					localOnly : true,
					loop : true,
					volume : 0.8
				});
				console.log("PLAYING");
			}
		});

		gapi.hangout.data.onStateChanged.add(function handleSharedState(ev) {
			console.log(ev);
			//if(parseInt(lastSharedState.playerCount, 10) > 1){
			var currentGameState = game.state.get(), newGameState = parseInt(ev.state.gameState, 10), lastScore = parseInt(ev.state.lastScore, 10), temp;

			// Save last state for easier access

			lastSharedState = ev.state;

			// Update game state if it changes
			// (take local states into consideration)
			if (!((currentGameState === game.state.LOST || currentGameState === game.state.LATEJOIN) && (newGameState === game.state.PLAYING)
			)) {
				currentGameState = newGameState;
				game.state.set(newGameState);
			}

			// Update game scores
			if ((currentGameState === game.state.PLAYING) && (lastScore > game.lastScore)) {
				game.lastScore = lastScore;
				temp = {};
				_.each(ev.state, function(value, key) {
					if (key.substr(0, 6) === 'score|') {
						temp[key.substr(6)] = parseInt(value, 10);
					}
				});
				//console.log("outside"+parseInt(lastSharedState.playerCount,10));
				if (parseInt(lastSharedState.playerCount, 10) > 1) {
					//console.log("inside"+parseInt(lastSharedState.playerCount,10));
					bean.fire(game, 'onPointScored', temp);
				} else {
					game.scores.set(temp);
				}
			}

		}
		//	}
		);
		gapi.hangout.onEnabledParticipantsChanged.add(function checkPresentPlayers(ev) {
			console.log("PLAYERS" + ev);
			if (game.state.get() === game.state.PLAYING) {
				// Check for list of players that started the game, but are not present anymore
				var presentPlayers = _.pluck(filterPlayers(ev.enabledParticipants), 'id'), droppedPlayers = _.filter(_.keys(game.scores.get()), function(item) {
					return !_.contains(presentPlayers, item);
				});
				if (droppedPlayers.length) {
					bean.fire(game, 'onPlayerDrop', droppedPlayers);
				}
			}

		});

		gapi.hangout.av.setLocalParticipantVideoMirrored(true);

		// BIND GAME EVENTS
		bean.on(game, 'onGameStart', function onGameStart() {

			var start_time, init_overlay = physics.ball_overlay_res.createOverlay({
				'position' : {
					'x' : 0,
					'y' : 0
				},
				'scale' : {
					'magnitude' : 0,
					'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
				}
			}), init_shadow = physics.ball_shadow_res.createOverlay({
				'position' : {
					'x' : 0,
					'y' : 0
				},
				'scale' : {
					'magnitude' : 0,
					'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
				}
			}), countdown_func = function(index) {
				if ((overlays.countdown.length - 1) > index) {
					try {
						overlays.countdown[index + 1].overlay.setVisible(false);
					} catch (e) {
					}
				}
				if (index >= 0) {
					try {
						overlays.countdown[index].overlay.setVisible(true);
					} catch (e) {
					}
					window.setTimeout(_.bind(countdown_func, this, index - 1), 750);
				} else {
					try {
						init_overlay.setVisible(true);
						init_shadow.setVisible(true);
					} catch (e) {
					}
					start_time = (new Date()).getTime();
					window.setTimeout(function() {
						ballanim_func((new Date()).getTime());
					}, 50);
					//window.requestAnimationFrame(ballanim_func);
				}
			}, ballanim_func = function(timestamp) {
				var factor = (timestamp - start_time) / 1000, limiter;
				if (factor >= 1) {

					try {
						init_shadow.setVisible(false);
						init_overlay.setVisible(false);
						init_overlay.dispose();
						init_shadow.dispose();
						init_overlay = null;
						init_shadow = null;
						if (physics.ball_overlay && physics.ball_shadow) {
							physics.ball_overlay.setVisible(true);
							physics.ball_shadow.setVisible(true);
						}
					} catch (e) {
					}

					limiter = function() {
						if (Box2D.Common.b2Settings.b2_maxTranslation < 8) {
							Box2D.Common.b2Settings.b2_maxTranslation += 0.25;
						}
						if (game.state.get() === game.state.PLAYING) {
							window.setTimeout(limiter, 1000);
						}
					};
					Box2D.Common.b2Settings.b2_maxTranslation = 1.0;
					window.setTimeout(limiter, 1000);

					window.requestAnimationFrame(tick);

				} else {
					try {
						init_overlay.setScale(factor * 0.75, gapi.hangout.av.effects.ScaleReference.HEIGHT);
						init_shadow.setScale(factor * 0.75, gapi.hangout.av.effects.ScaleReference.HEIGHT);
					} catch (e) {
					}
					window.setTimeout(function() {
						ballanim_func((new Date()).getTime());
					}, 50);

					//window.requestAnimationFrame(ballanim_func);
				}
			};

			//physics.speedup_factor = 1;
			physics.createTracker();
			physics.createBall();
			try {
				if (physics.ball_overlay && physics.ball_shadow) {
					physics.ball_overlay.setVisible(false);
					physics.ball_shadow.setVisible(false);
				}

				init_overlay.setVisible(false);
				init_shadow.setVisible(false);
			} catch (e) {
			}
			countdown_func(3);

		});
		bean.on(game, 'onGameLost', function onGameLost() {
			console.log("gameLost");
			physics.destroyTracker();
			physics.destroyBall();

			var delta = {}, removal = [], newPlayerCount = parseInt(lastSharedState.playerCount, 10) - 1;

			if (newPlayerCount <= 0) {
				console.log("aaaaaaand dead. : " + newPlayerCount);
				delta.gameState = '' + game.state.ENDED;
				removal = _.chain(lastSharedState).keys().filter(function(item) {
					return item.substr(0, 6) === 'score|';
				}).value();
				removal.push('lastScore');
				removal.push('playerCount');
				if (newPlayerCount === 0) {
					console.log("endGameRightHere");
					overlays.lost.overlay.setVisible(true);
					game.state.set(2);
				}
			} else {
				delta.playerCount = '' + newPlayerCount;
			}
			gapi.hangout.data.submitDelta(delta, removal);
			overlays.lost.overlay.setVisible(true);
			//	game.state.set(2);
			//overlays.lost.overlay.setVisible(true);
			window.setTimeout(_.bind(overlays.lost.overlay.setVisible, overlays.lost.overlay, false), 1000);

		});
		bean.on(game, 'onGameEnd', function onGameEnd() {

			overlays.end.overlay.setVisible(true);
			window.setTimeout(_.bind(overlays.end.overlay.setVisible, overlays.end.overlay, false), 1000);

		});

		var changePoints = function animPoints(counter, number) {

			var newAmount = parseInt(number, 10), oldAmount = counter.innerHTML, counter_pos = [], i, anim_func, style_func;

			// Determine which counters should be made
			if (newAmount >= 1000) {
				newAmount = 999;
			}
			newAmount = '' + newAmount;

			for ( i = Math.max(newAmount.length, oldAmount.length) - 1; i >= 0; i -= 1) {
				if (newAmount.substr(i, 1) !== oldAmount.substr(i, 1)) {
					counter_pos.push(i);
				}
			}
			counter_pos.sort();
			counter_pos = _.map(counter_pos, function(index) {
				var el = document.createElement('div');
				el.className = 'counter step3';
				el.style.left = (index * 80) + 'px';
				counter.appendChild(el);
				return el;
			});

			i = 3;
			style_func = function(el) {
				el.className = 'counter step' + i;
			};
			anim_func = function counterAnimation() {
				i -= 1;
				if (i === -1) {
					counter.innerHTML = newAmount;
				}
				if (i < 0) {
					_.each(counter_pos, function(el) {
						try {
							counter.removeChild(el);
						} catch (e) {
						}
					});
				} else {
					_.each(counter_pos, style_func);
					window.setTimeout(anim_func, 100);
				}
			};
			window.setTimeout(anim_func, 100);

		};
		bean.on(game, 'onPointScored', function onPointScored(points) {

			// Update point storage
			game.scores.set(points);
			var newScores = game.scores.get();

			// Update DOM to reflect new points

			changePoints(document.getElementById('local'), newScores[gapi.hangout.getLocalParticipantId()]);
			changePoints(document.getElementById('team'), _.reduce(newScores, function(a, b) {
				return a + b;
			}));

		});

		bean.on(game, 'onPlayerDrop', function onPlayerDrop(droppedPlayers) {

			// Remove missing players' scoring
			_.each(droppedPlayers, game.scores.remove);

			// Refresh the score
			bean.fire(game, 'onPointScored', {});

			// Remove missing players from shared state
			gapi.hangout.data.submitDelta({}, _.map(droppedPlayers, function(item) {
				return 'score|' + item;
			}));

		});

		/* GAME PHYSICS
		 * ******************************************
		 * Initialize various aspects of Box2D physics engine to have it working
		 * on bouncing the ball. Load required resources and so on.
		 */

		var video = gapi.hangout.layout.getVideoCanvas(), scaling_keys = _.map(_.keys(physics.scaling_map), parseFloat), body_def = new Box2D.Dynamics.b2BodyDef(), fixture_def = new Box2D.Dynamics.b2FixtureDef(), contact = new Box2D.Dynamics.b2ContactListener(), sharedState;

		physics.area_width = video.getWidth(), physics.area_height = video.getHeight();
		if (document.getElementById('physics_test')) {
			document.getElementById('physics_test').width = physics.area_width;
			document.getElementById('physics_test').height = physics.area_height;
		}

		// Set up world with null gravity
		physics.world = new Box2D.Dynamics.b2World(new Vector(0, 9.8), false);

		// Establish side walls to prevent the ball from falling off sides
		body_def.type = Box2D.Dynamics.b2Body.b2_staticBody;
		fixture_def.friction = 0.5;
		fixture_def.restitution = 0.8;
		fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
		fixture_def.shape.SetAsBox(2, physics.area_height * 10);

		body_def.position.Set(-1, 0);
		physics.world.CreateBody(body_def).CreateFixture(fixture_def);
		body_def.position.Set(physics.area_width + 1, 0);
		physics.world.CreateBody(body_def).CreateFixture(fixture_def);

		// Set one up at the top to prevent ball from falling off-screen
		fixture_def.shape.SetAsBox(physics.area_width * 2, 2);
		body_def.position.Set(physics.area_width / 2, physics.area_height / -8);
		body_def.restitution = 0.8;
		physics.world.CreateBody(body_def).CreateFixture(fixture_def);

		// Set up contact listener
		contact.BeginContact = function(contact) {
			var bodyA = contact.GetFixtureA().GetBody(), bodyB = contact.GetFixtureB().GetBody(), delta, id;

			if (((bodyA === physics.head_tracker) && (bodyB === physics.ball)) || ((bodyA === physics.ball) && (bodyB === physics.head_tracker))) {
				// Only count downward-moving ball
				if (bodyB.GetLinearVelocity().y > 0) {

					delta = {};
					id = gapi.hangout.getLocalParticipantId();
					delta['score|' + id] = '' + (game.scores.get()[id] + 1);
					if (parseInt(lastSharedState.playerCount, 10) === 1) {
						//	game.scores[id] = game.scores[id] + 1;
						console.log(game.localScore);
						game.localScore = game.localScore + 1;
					}
					delta.lastScore = '' + (new Date()).getTime();
					gapi.hangout.data.submitDelta(delta, []);
					//rotator(physics.ball_overlay);
					physics.lastVelocity = physics.ball.GetLinearVelocity();
					physics.bounced = true;
					console.log("insideContact" + parseInt(lastSharedState.playerCount, 10));
					if (parseInt(lastSharedState.playerCount, 10) === 1) {
						//console.log("insideSettingPoints"+newScores);
						console.log(game.localScore);
						changePoints(document.getElementById('local'), game.localScore);
						changePoints(document.getElementById('team'), game.localScore);
					}
					bounce.play({
						localOnly : true,
						loop : false,
						volume : 1
					});

				}

			}
		};

		contact.EndContact = function(contact) {
			//var bodyA = contact.GetFixtureA().GetBody(), bodyB = contact.GetFixtureB().GetBody(), ball_velocity, new_velocity, temp;
			var bodyA, bodyB, ball_velocity, new_velocity, temp;
			//if (((bodyA === physics.head_tracker) && (bodyB === physics.ball)) || ((bodyA === physics.ball) && (bodyB === physics.head_tracker))) {
			bodyA = physics.head_tracker;
			bodyB = physics.ball;
			ball_velocity = physics.ball.GetLinearVelocity();
			new_velocity = physics.lastVelocity;
			temp = ball_velocity.Length();
			clearInterval(physics.rotateTimer);
			rotate = (0.5 - Math.random()) / 10;
			//rotateInterval
			physics.rotateTimer = setInterval(function() {
				physics.rotator(physics.ball_overlay);
			}, physics.rotateInterval);

			//}
		};

		physics.world.SetContactListener(contact);

		// Set up mouse joint definition
		physics.track_joint_def = new Box2D.Dynamics.Joints.b2MouseJointDef();

		if (document.getElementById('physics_test')) {
			// Set up debug tracking of the world
			var debugDraw = new Box2D.Dynamics.b2DebugDraw();
			debugDraw.SetSprite(document.getElementById("physics_test").getContext("2d"));
			debugDraw.SetDrawScale(1.0);
			debugDraw.SetFillAlpha(0.5);
			debugDraw.SetLineThickness(1.0);
			debugDraw.SetFlags(Box2D.Dynamics.b2DebugDraw.e_shapeBit | Box2D.Dynamics.b2DebugDraw.e_jointBit);
			physics.world.SetDebugDraw(debugDraw);
		}

		// Set up handling of incoming face tracking data;
		// specifically, the update of tracker position and rescaling
		var faceDataChange = function faceDataChange(faceData) {
			var i, scale, biggest_scale = -1, currentGameState = game.state.get();

			if (faceData.hasFace) {

				// Calculate the scale (and adjust object accordingly if scale is different from previous frame)
				scale = Math.abs(faceData.leftEye.x - faceData.rightEye.x);
				for ( i = 0; i < scaling_keys.length; i += 1) {
					if (scaling_keys[i] <= scale && scaling_keys[i] > biggest_scale) {
						biggest_scale = scaling_keys[i];
					}
				}
				if (biggest_scale === -1) {
					biggest_scale = scaling_keys[0];
				}

				// Determine what scales to applya
				if (physics.scaling_map[biggest_scale] !== physics.last_scale) {

					physics.last_scale = physics.scaling_map[biggest_scale];
					physics.unit_width = physics.area_width / physics.last_scale;
					physics.unit_height = physics.area_height / physics.last_scale;

					if (currentGameState === game.state.PLAYING) {
						physics.createTracker();
						physics.createBall();
					}

				}

				if (currentGameState === game.state.PLAYING) {

					// Track face position
					if (!physics.track_joint) {
						physics.createJoint();
					}
					physics.track_joint.SetTarget(new Vector((faceData.noseRoot.x + 0.5) * physics.area_width, (faceData.noseRoot.y - Math.abs(faceData.leftEye.x - faceData.rightEye.x) + 0.5) * physics.area_height));
					physics.head_tracker.SetAngle(faceData.roll);

				}

			} else {

				if (currentGameState === game.state.PLAYING) {

					// Disable face tracking if data not present
					if (physics.track_joint) {
						physics.destroyJoint();
					}

				}

			}
		};
		gapi.hangout.av.effects.onFaceTrackingDataChanged.add(faceDataChange);
		faceDataChange({
			'hasFace' : true,
			'leftEye' : {
				'x' : -0.05,
				'y' : 0
			},
			'rightEye' : {
				'x' : 0.05,
				'y' : 0
			},
			'noseRoot' : {
				'x' : 0,
				'y' : 0
			},
			'roll' : 0
		});

		// Load image resources
		physics.ball_overlay_res = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/ball.png');
		physics.ball_shadow_res = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/ballShadow.png');

		overlays.lost.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_lost.png');
		overlays.lost.resource.onLoad.add(function createOverlay(ev) {
			if (ev.isLoaded) {
				overlays.lost.overlay = overlays.lost.resource.createOverlay({
					'position' : {
						'x' : 0,
						'y' : 0
					},
					'scale' : {
						'magnitude' : 0.35,
						'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
					}
				});
				overlays.lost.overlay.setVisible(false);
			}
		});
		overlays.end.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_end.png');
		overlays.end.resource.onLoad.add(function createOverlay(ev) {
			if (ev.isLoaded) {
				overlays.end.overlay = overlays.end.resource.createOverlay({
					'position' : {
						'x' : 0,
						'y' : 0
					},
					'scale' : {
						'magnitude' : 0.35,
						'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
					}
				});
				overlays.end.overlay.setVisible(false);
			}
		});
		_.each(overlays.countdown, function(obj, index) {

			obj.resource = gapi.hangout.av.effects.createImageResource(baseUrl + 'images/overlay_count' + index + '.png');
			obj.resource.onLoad.add(function createOverlay(ev) {
				if (ev.isLoaded) {
					obj.overlay = obj.resource.createOverlay({
						'position' : {
							'x' : 0,
							'y' : 0
						},
						'scale' : {
							'magnitude' : 0.35,
							'reference' : gapi.hangout.av.effects.ScaleReference.HEIGHT
						}
					});
					obj.overlay.setVisible(false);
				}
			});

		});

		// Set to late join state if appropriate
		sharedState = gapi.hangout.data.getState();

		if (('gameState' in sharedState) && (parseInt(sharedState.gameState, 10) === game.state.PLAYING)) {
			game.state.set(game.state.LATEJOIN);
		}

		bean.on(document.getElementsByTagName('button')[0], 'click', function() {
			if (physics.ball_overlay_res.isLoaded() && physics.ball_shadow_res.isLoaded()) {
				if (game.state.get() !== game.state.PLAYING) {

					var participants = filterPlayers(gapi.hangout.getEnabledParticipants()), removal = [], delta = {
						'gameState' : '' + game.state.PLAYING,
						'playerCount' : '' + participants.length,
						'lastScore' : '' + (new Date()).getTime()
					};
					console.log(participants);
					_.each(participants, function(player) {
						delta['score|' + player.id] = '0';
					});
					removal = _.chain(lastSharedState).keys().filter(function(item) {
						return item.substr(0, 6) === 'score|' && !_.has(delta, item);
					}).value();

					gapi.hangout.data.submitDelta(delta, removal);

				}
			}
		});
		bean.on(document.getElementById('share'), 'click', function(ev) {
			ev.preventDefault();
			window.open(document.getElementById('share').href, 'Share', 'width=600,height=450');
		});

	};

	gapi.hangout.onApiReady.add(initialize);

};
