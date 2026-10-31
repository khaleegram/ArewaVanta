<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CaptainInvitationController;
use App\Http\Controllers\Api\V1\Manage\AdminActivityController;
use App\Http\Controllers\Api\V1\Manage\AuditController;
use App\Http\Controllers\Api\V1\Manage\CompetitionEventController;
use App\Http\Controllers\Api\V1\Manage\CompetitionOrganizerInvitationController;
use App\Http\Controllers\Api\V1\Manage\CompetitionSquadsController;
use App\Http\Controllers\Api\V1\Manage\CompetitionTemplateController;
use App\Http\Controllers\Api\V1\Manage\DirectoryController;
use App\Http\Controllers\Api\V1\Manage\EventExportController;
use App\Http\Controllers\Api\V1\Manage\EventQueriesController;
use App\Http\Controllers\Api\V1\Manage\EventRecurrenceController;
use App\Http\Controllers\Api\V1\Manage\EventScheduleController;
use App\Http\Controllers\Api\V1\Manage\EventSquadSubmissionController;
use App\Http\Controllers\Api\V1\Manage\MatchResultController;
use App\Http\Controllers\Api\V1\Manage\MatchResultSheetController;
use App\Http\Controllers\Api\V1\Manage\MatchScoringController;
use App\Http\Controllers\Api\V1\Manage\OrganizationController;
use App\Http\Controllers\Api\V1\Manage\PeopleController;
use App\Http\Controllers\Api\V1\Manage\ScoringPresetController as ManageScoringPresetController;
use App\Http\Controllers\Api\V1\Manage\SeasonController;
use App\Http\Controllers\Api\V1\Manage\StoreCompetitionTemplateController;
use App\Http\Controllers\Api\V1\Manage\UpdateEventController;
use App\Http\Controllers\Api\V1\PasswordRecoveryController;
use App\Http\Controllers\Api\V1\Public\EventController as PublicEventController;
use App\Http\Controllers\Api\V1\Public\EventStandingsController;
use App\Http\Controllers\Api\V1\Public\MatchResultsController;
use App\Http\Controllers\Api\V1\Public\OrganizationController as PublicOrganizationController;
use App\Http\Controllers\Api\V1\Public\PlayerController;
use App\Http\Controllers\Api\V1\Public\PlayerRankingsController;
use App\Http\Controllers\Api\V1\Public\ScoringPresetController;
use App\Http\Controllers\Api\V1\Public\SeasonStandingsController;
use App\Http\Controllers\Api\V1\Public\SquadHistoryController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/register', [AuthController::class, 'register'])
        ->middleware('throttle:5,1')
        ->name('api.v1.auth.register');
    Route::post('/auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:5,1')
        ->name('api.v1.auth.login');
    Route::post('/auth/forgot-password', [PasswordRecoveryController::class, 'sendLink'])
        ->middleware('throttle:5,1')
        ->name('api.v1.auth.password.email');
    Route::post('/auth/reset-password', [PasswordRecoveryController::class, 'reset'])
        ->middleware('throttle:10,1')
        ->name('api.v1.auth.password.reset');
    Route::post('/captain-invitations/inspect', [CaptainInvitationController::class, 'inspect'])->middleware('throttle:30,1');
    Route::post('/captain-invitations/accept', [CaptainInvitationController::class, 'accept'])->middleware('throttle:5,1');
    Route::post('/competition-organizer-invitations/inspect', [CompetitionOrganizerInvitationController::class, 'inspect'])->middleware('throttle:30,1');
    Route::post('/competition-organizer-invitations/accept', [CompetitionOrganizerInvitationController::class, 'accept'])->middleware('throttle:5,1');
    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('/auth/logout', [AuthController::class, 'logout'])->name('api.v1.auth.logout');
        Route::get('/auth/me', [AuthController::class, 'me'])->name('api.v1.auth.me');
    });

    Route::middleware('throttle:public-read')->group(function (): void {
        Route::get('/scoring-presets', ScoringPresetController::class)
            ->name('api.v1.scoring-presets.index');
        Route::get('/events', [PublicEventController::class, 'index'])
            ->name('api.v1.events.index');
        Route::get('/events/{event}', [PublicEventController::class, 'show'])
            ->name('api.v1.events.show');
        Route::get('/events/{event}/standings', EventStandingsController::class)
            ->name('api.v1.events.standings');
        Route::get('/matches/{match}/results', MatchResultsController::class)
            ->name('api.v1.matches.results');
        Route::get('/matches/{match}/standings', [MatchResultsController::class, 'standings'])->name('api.v1.matches.standings');
        Route::get('/clans/{clan}', [PublicOrganizationController::class, 'clan'])->name('api.v1.clans.show');
        Route::get('/squads/{squad}/history', SquadHistoryController::class)->name('api.v1.squads.history');
        Route::get('/squads/{squad}', [PublicOrganizationController::class, 'squad'])->name('api.v1.squads.show');
        Route::get('/players/{player}', [PlayerController::class, 'show'])
            ->name('api.v1.players.show');
        Route::get('/rankings/players', PlayerRankingsController::class)->name('api.v1.players.rankings');
        Route::get('/seasons/{season}/standings', SeasonStandingsController::class)->name('api.v1.seasons.standings');
    });
    Route::get('/clans', [PublicOrganizationController::class, 'clans'])
        ->middleware('throttle:public-search')
        ->name('api.v1.clans.index');
    Route::get('/players', [PlayerController::class, 'index'])
        ->middleware('throttle:public-search')
        ->name('api.v1.players.index');

    Route::middleware('auth:sanctum')->prefix('manage')->name('api.v1.manage.')->group(function (): void {
        Route::get('/activity', [AdminActivityController::class, 'index']);
        Route::post('/activity/read', [AdminActivityController::class, 'read']);
        Route::post('/push-subscriptions', [AdminActivityController::class, 'subscribe']);
        Route::delete('/push-subscriptions', [AdminActivityController::class, 'unsubscribe']);
        Route::get('/people', [PeopleController::class, 'index'])->name('people.index');
        Route::get('/seasons', [SeasonController::class, 'index'])->name('seasons.index');
        Route::post('/seasons', [SeasonController::class, 'store'])->name('seasons.store');
        Route::get('/seasons/{season}/standings', [SeasonController::class, 'standings'])->name('seasons.standings');
        Route::get('/audit-logs', [AuditController::class, 'index'])->name('audit-logs.index');
        Route::post('/people/{user}/roles', [PeopleController::class, 'assign'])->name('people.roles.store');
        Route::delete('/people/{user}/roles/{assignment}', [PeopleController::class, 'revoke'])->name('people.roles.destroy');
        Route::get('/clans', [OrganizationController::class, 'index'])->name('clans.index');
        Route::post('/clans/{clan}/captain-invitations', [CaptainInvitationController::class, 'send'])->middleware('throttle:10,1');
        Route::post('/clans', [OrganizationController::class, 'registerClan'])->name('clans.store');
        Route::patch('/clans/{clan}', [DirectoryController::class, 'updateClan'])->name('clans.update');
        Route::post('/clans/{clan}/squads', [OrganizationController::class, 'createSquad'])->name('squads.store');
        Route::patch('/squads/{squad}', [DirectoryController::class, 'updateSquad'])->name('squads.update');
        Route::post('/players', [DirectoryController::class, 'storePlayer'])->name('players.store');
        Route::get('/players/{player}', [DirectoryController::class, 'showPlayer'])->name('players.show');
        Route::patch('/players/{player}', [DirectoryController::class, 'updatePlayer'])->name('players.update');
        Route::get('/squads/{squad}/roster', [OrganizationController::class, 'roster'])->name('rosters.show');
        Route::post('/squads/{squad}/roster', [OrganizationController::class, 'addRosterPlayer'])->name('rosters.store');
        Route::delete('/squads/{squad}/roster/{player}', [OrganizationController::class, 'removeRosterPlayer'])->name('rosters.destroy');
        Route::get('/squads/{squad}/event-submissions', [EventSquadSubmissionController::class, 'forSquad'])->name('squad-submissions.index');
        Route::post('/squads/{squad}/event-submissions', [EventSquadSubmissionController::class, 'storeForSquad'])->name('squad-submissions.store');
        Route::delete('/squads/{squad}/event-submissions/{submission}', [EventSquadSubmissionController::class, 'withdraw'])->name('squad-submissions.destroy');
        Route::get('/competition-templates', CompetitionTemplateController::class)
            ->name('competition-templates.index');
        Route::post('/competition-templates', StoreCompetitionTemplateController::class)
            ->name('competition-templates.store');
        Route::get('/scoring-presets', [ManageScoringPresetController::class, 'index'])->name('scoring-presets.index');
        Route::post('/scoring-presets', [ManageScoringPresetController::class, 'store'])->name('scoring-presets.store');
        Route::post('/scoring-presets/{preset}/clone', [ManageScoringPresetController::class, 'clone'])->name('scoring-presets.clone');
        Route::put('/scoring-presets/{preset}', [ManageScoringPresetController::class, 'version'])->name('scoring-presets.update');
        Route::post('/scoring-preview', [ManageScoringPresetController::class, 'preview'])->name('scoring-preview');
        Route::get('/events', [EventQueriesController::class, 'index'])
            ->name('events.index');
        Route::get('/events/{event}', [EventQueriesController::class, 'show'])
            ->name('events.show');
        Route::post('/events/{event}/organizer-invitations', [CompetitionOrganizerInvitationController::class, 'send'])->middleware('throttle:10,1')->name('events.organizer-invitations.store');
        Route::get('/events/{event}/submissions', [EventSquadSubmissionController::class, 'forEvent'])->name('events.submissions.index');
        Route::patch('/events/{event}/submissions/{submission}', [EventSquadSubmissionController::class, 'decide'])->name('events.submissions.update');
        Route::get('/events/{event}/export/results', [EventExportController::class, 'results'])->name('events.export.results');
        Route::get('/events/{event}/export/standings', [EventExportController::class, 'standings'])->name('events.export.standings');
        Route::post('/events', CompetitionEventController::class)
            ->name('events.store');
        Route::patch('/events/{event}/recurrence', EventRecurrenceController::class)->name('events.recurrence.update');
        Route::patch('/events/{event}', UpdateEventController::class)
            ->name('events.update');
        Route::delete('/events/{event}', [UpdateEventController::class, 'destroy'])->name('events.destroy');
        Route::put('/events/{event}/schedule', EventScheduleController::class)->name('events.schedule.update');
        Route::put('/events/{event}/squads', [CompetitionSquadsController::class, 'event'])
            ->name('events.squads.update');
        Route::put('/matches/{match}/squads', [CompetitionSquadsController::class, 'match'])
            ->name('matches.squads.update');
        Route::get('/matches/{match}/result-sheet', MatchResultSheetController::class)
            ->name('matches.result-sheet.show');
        Route::patch('/matches/{match}/scoring', MatchScoringController::class)
            ->name('matches.scoring.update');
        Route::put('/matches/{match}/results', [MatchResultController::class, 'save'])->name('matches.results.save');
    });
});
