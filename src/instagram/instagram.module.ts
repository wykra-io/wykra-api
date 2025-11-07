import { Module } from "@nestjs/common";

import { BrightdataConfigModule, OpenrouterConfigModule } from "@libs/config";

import { InstagramController } from "./instagram.controller";
import { InstagramService } from "./instagram.service";

@Module({
  imports: [BrightdataConfigModule, OpenrouterConfigModule],
  controllers: [InstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
