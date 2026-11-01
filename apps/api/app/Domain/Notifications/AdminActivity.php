<?php

namespace App\Domain\Notifications;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

final class AdminActivity
{
    public function record(User $actor, string $message): void
    {
        $admins = User::query()->whereHas('roleAssignments', fn ($query) => $query->where('role', Role::PlatformAdmin->value)->where('scope_type', RoleScope::Global->value)->where('scope_id', '*'))->whereKeyNot($actor->id)->pluck('id');
        $this->notifyUsers($admins->all(), $message, '/manage/directory');
    }

    /** @param list<string> $clanIds */
    public function notifyClanCaptains(array $clanIds, string $message, string $url, ?string $tag = null): void
    {
        $clanIds = array_values(array_unique(array_filter(array_map('strval', $clanIds))));
        if ($clanIds === []) {
            return;
        }

        $captains = User::query()
            ->whereHas('roleAssignments', fn ($query) => $query
                ->where('role', Role::ClanCaptain->value)
                ->where('scope_type', RoleScope::Clan->value)
                ->whereIn('scope_id', $clanIds))
            ->pluck('id')
            ->all();

        $this->notifyUsers($captains, $message, $url, $tag);
    }

    /** @param list<int|string> $userIds */
    private function notifyUsers(array $userIds, string $message, string $url, ?string $tag = null): void
    {
        $userIds = array_values(array_unique($userIds));
        if ($userIds === []) {
            return;
        }

        $message = Str::limit($message, 255, '');
        foreach ($userIds as $id) {
            DB::table('admin_activity')->insert([
                'user_id' => $id,
                'message' => $message,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::afterCommit(fn () => $this->push($userIds, $message, $url, $tag));
    }

    /** @param list<int|string> $userIds */
    private function push(array $userIds, string $message, string $url, ?string $tag): void
    {
        $public = config('services.web_push.public_key');
        $private = config('services.web_push.private_key');
        $subject = config('services.web_push.subject');
        if (! $public || ! $private || ! $subject) {
            return;
        }
        try {
            $push = new WebPush(['VAPID' => ['subject' => $subject, 'publicKey' => $public, 'privateKey' => $private]], ['TTL' => 3600]);
            $payload = json_encode([
                'title' => 'ArewaVanta',
                'body' => $message,
                'url' => $url,
                'tag' => $tag,
            ], JSON_THROW_ON_ERROR);
            foreach (DB::table('admin_push_subscriptions')->whereIn('user_id', $userIds)->get() as $item) {
                try {
                    $subscription = Subscription::create(['endpoint' => $item->endpoint, 'keys' => ['p256dh' => $item->public_key, 'auth' => $item->auth_token], 'contentEncoding' => 'aes128gcm']);
                    $result = $push->sendOneNotification($subscription, $payload);
                    if ($result->isSubscriptionExpired()) {
                        DB::table('admin_push_subscriptions')->where('id', $item->id)->delete();
                    }
                } catch (\Throwable $error) {
                    report($error);
                }
            }
        } catch (\Throwable $error) {
            report($error);
        }
    }
}
